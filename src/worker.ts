// The plugin's worker: it holds the tokens, talks to Confluence and Jira and writes the read-only
// Markdown copies that open in tabs. Orca starts it on first use and transpiles this file itself.
import type { OrcaWorkerApi } from 'orca/worker'
import { copyText, readText } from './clipboard'
import { currentUser, page, search, type Connection, type Page } from './confluence'
import { detectLink } from './detect'
import { issue, myself, searchIssues, type Issue, type JiraConnection } from './jira'
import { issueDocument } from './jira-document'
import { jiraKeyIn, jqlFor, jqlPassthrough, projectKeys } from './jira-links'
import { normaliseBase, pageFileName, pageIdIn, readableLink, searchCql, spaceKeys, type LinkStyle } from './links'
import type { ConnectionStatus, Hit, Outcome, Product } from './protocol'
import { storageToMarkdown } from './storage-to-markdown'
import { focusedWorkspace, writeTabFile } from './tab-file'

const RECENT = 'recent'
const RECENT_MAX = 30
const SECRET: Record<Product, string> = { confluence: 'confluenceToken', jira: 'jiraToken' }
const NAME: Record<Product, string> = { confluence: 'Confluence', jira: 'Jira' }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown')
const yaml = (value: string | number) => (typeof value === 'number' ? String(value) : JSON.stringify(value))

interface Resolved<C> {
  conn: C | null
  status: ConnectionStatus
}

async function resolve(orca: OrcaWorkerApi, product: Product): Promise<Resolved<Connection & JiraConnection>> {
  const settings = await orca.settings.get()
  const prefix = product === 'confluence' ? 'confluence' : 'jira'
  const baseUrl = normaliseBase(settings[`${prefix}Url`])
  const auth = settings[`${prefix}Auth`] === 'basic' ? 'basic' : 'bearer'
  const email = typeof settings[`${prefix}Email`] === 'string' ? String(settings[`${prefix}Email`]).trim() : ''
  const token = (await orca.secrets.get(SECRET[product])) ?? ''
  const linkStyle: LinkStyle = settings.linkStyle === 'webui' ? 'webui' : 'viewpage'
  const configured = Boolean(baseUrl) && (auth === 'bearer' || Boolean(email))
  const status: ConnectionStatus = { product, configured, hasToken: Boolean(token), baseUrl }
  return { conn: configured && token ? { baseUrl, auth, email, token, linkStyle } : null, status }
}

function notReady(status: ConnectionStatus): string {
  const name = NAME[status.product]
  if (!status.baseUrl) return `Set the ${name} base URL first (Settings → Plugins → Atlassian).`
  if (!status.configured) return `${name} Cloud needs your Atlassian e-mail too (Settings → Plugins → Atlassian).`
  return `Save a ${name} token first (the panel's ${name} tab, Connection).`
}

async function test(orca: OrcaWorkerApi, product: Product): Promise<ConnectionStatus> {
  const { conn, status } = await resolve(orca, product)
  if (!conn) return { ...status, error: notReady(status) }
  try {
    return { ...status, user: product === 'confluence' ? await currentUser(fetch, conn) : await myself(fetch, conn) }
  } catch (error) {
    return { ...status, error: message(error) }
  }
}

const pageHit = (p: { id: string; title: string; spaceKey: string; spaceName: string; version: number; url: string; updatedAt: number }): Hit => ({
  product: 'confluence',
  id: p.id,
  title: p.title,
  detail: [p.spaceName || p.spaceKey, p.version ? `v${p.version}` : ''].filter(Boolean).join(' · '),
  url: p.url,
  updatedAt: p.updatedAt
})

const issueHit = (i: { key: string; summary: string; type: string; status: string; assignee: string; url: string; updatedAt: number }): Hit => ({
  product: 'jira',
  id: i.key,
  title: `${i.key}: ${i.summary}`,
  detail: [i.type, i.status, i.assignee].filter(Boolean).join(' · '),
  url: i.url,
  updatedAt: i.updatedAt
})

async function remember(orca: OrcaWorkerApi, entry: Hit): Promise<Hit[]> {
  const stored = await orca.storage.get(RECENT)
  const list = (Array.isArray(stored) ? (stored as unknown as Hit[]) : []).filter((h) => !(h?.product === entry.product && h?.id === entry.id))
  const results = [entry, ...list].slice(0, RECENT_MAX)
  await orca.storage.set(RECENT, results as unknown as never)
  return results
}

/** The page tab's Markdown: front matter for later tools, a note that it is a copy, then the page. */
export function pageDocument(p: Page, body: string, fetchedAt: Date): string {
  const trail = p.ancestors.map((a) => a.title).filter(Boolean)
  return [
    '---',
    'confluence:',
    `  id: ${yaml(p.id)}`,
    `  title: ${yaml(p.title)}`,
    `  space: ${yaml(p.spaceKey)}`,
    `  version: ${yaml(p.version)}`,
    `  url: ${yaml(p.url)}`,
    `  updated: ${yaml(day(p.updatedAt))}`,
    `  fetched: ${yaml(fetchedAt.toISOString())}`,
    '---',
    '',
    `> Read-only copy of ${readableLink(p.title, p.url)} (space ${p.spaceKey}, version ${p.version}, updated ${day(p.updatedAt)}), fetched ${fetchedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Edits here are not sent to Confluence; open it again to refresh.`,
    ...(trail.length ? ['>', `> ${trail.join(' › ')}`] : []),
    '',
    `# ${p.title}`,
    '',
    body.trim(),
    ''
  ].join('\n')
}

export default function activate(orca: OrcaWorkerApi): void {
  const call = (method: string, params?: unknown) => orca.host.call(method as never, params as never) as Promise<any>

  /** Writes the copy into the focused workspace and opens it in a tab. */
  async function openTab(relative: string, text: string): Promise<Outcome | null> {
    const workspace = await focusedWorkspace(call)
    if (!workspace) return { ok: false, message: 'Open a local workspace first; copies open in a tab there.' }
    const path = await writeTabFile(workspace.path, relative, text)
    await call('editor.open', { workspaceId: workspace.id, path })
    return null
  }

  async function openPage(id: string): Promise<Outcome> {
    const { conn, status } = await resolve(orca, 'confluence')
    if (!conn) return { ok: false, message: notReady(status) }
    const found = await page(fetch, conn, id)
    const body = storageToMarkdown(found.storage, { baseUrl: conn.baseUrl, spaceKey: found.spaceKey, pageUrl: found.url })
    const refused = await openTab(`confluence/${found.spaceKey || 'page'}/${pageFileName(found.id, found.title)}`, pageDocument(found, body, new Date()))
    if (refused) return refused
    orca.panels.post('recent.changed', { results: await remember(orca, pageHit(found)) })
    return { ok: true, message: `Opened ${found.title} (version ${found.version}).` }
  }

  async function openIssue(key: string): Promise<Outcome> {
    const { conn, status } = await resolve(orca, 'jira')
    if (!conn) return { ok: false, message: notReady(status) }
    const found: Issue = await issue(fetch, conn, key)
    const toMarkdown = (html: string, pageUrl: string) => storageToMarkdown(html, { baseUrl: conn.baseUrl, spaceKey: '', pageUrl })
    const project = found.key.split('-')[0]
    const refused = await openTab(`jira/${project}/${found.key}.md`, issueDocument(found, { baseUrl: conn.baseUrl }, new Date(), toMarkdown))
    if (refused) return refused
    orca.panels.post('recent.changed', { results: await remember(orca, issueHit(found)) })
    return { ok: true, message: `Opened ${found.key}: ${found.summary}.` }
  }

  async function open(product: Product, id: string): Promise<Outcome> {
    try {
      return product === 'jira' ? await openIssue(id) : await openPage(id)
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  }

  async function openLink(text: string): Promise<Outcome> {
    const [confluence, jira] = await Promise.all([resolve(orca, 'confluence'), resolve(orca, 'jira')])
    const target = detectLink(text, { confluence: confluence.status.baseUrl, jira: jira.status.baseUrl })
    if (!target) return { ok: false, message: 'That is not a Jira or Confluence link (or an issue key) on the sites in Settings.' }
    if ('id' in target) return open(target.product, target.id)
    if (!confluence.conn) return { ok: false, message: notReady(confluence.status) }
    try {
      const cql = `type = page AND space = ${JSON.stringify(target.space)} AND title = ${JSON.stringify(target.title)}`
      const found = await search(fetch, confluence.conn, cql, 1)
      if (!found.results.length) return { ok: false, message: `No page "${target.title}" in space ${target.space}.` }
      return open('confluence', found.results[0].id)
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  }

  orca.panels.handle('conn.status', async ({ product }) => (await resolve(orca, product)).status)
  orca.panels.handle('conn.test', ({ product }) => test(orca, product))
  orca.panels.handle('conn.setToken', async ({ product, token }) => {
    const value = token.trim()
    if (!value) return { ...(await resolve(orca, product)).status, error: 'The token is empty.' }
    await orca.secrets.set(SECRET[product], value)
    return test(orca, product)
  })
  orca.panels.handle('conn.clearToken', async ({ product }) => {
    await orca.secrets.delete(SECRET[product])
    return (await resolve(orca, product)).status
  })

  orca.panels.handle('scopes', async ({ product }) => {
    const settings = await orca.settings.get()
    return { keys: product === 'jira' ? projectKeys(settings.jiraProjects) : spaceKeys(settings.confluenceSpaces) }
  })

  orca.panels.handle('search', async ({ product, query, scope, raw }) => {
    const { conn, status } = await resolve(orca, product)
    if (!conn) return { results: [], total: 0, error: notReady(status) }
    try {
      if (product === 'jira') {
        const key = raw ? null : jiraKeyIn(query, conn.baseUrl)
        if (key) return { results: [issueHit(await issue(fetch, conn, key))], total: 1 }
        const found = await searchIssues(fetch, conn, raw ? jqlPassthrough(query, scope) : jqlFor(query, scope))
        return { results: found.results.map(issueHit), total: found.total }
      }
      const id = raw ? null : pageIdIn(query)
      if (id) return { results: [pageHit(await page(fetch, conn, id))], total: 1 }
      const found = await search(fetch, conn, searchCql(query, scope, raw))
      return { results: found.results.map(pageHit), total: found.total }
    } catch (error) {
      return { results: [], total: 0, error: message(error) }
    }
  })

  orca.panels.handle('recent', async () => {
    const stored = await orca.storage.get(RECENT)
    return { results: Array.isArray(stored) ? (stored as unknown as Hit[]) : [] }
  })

  orca.panels.handle('open', ({ product, id }) => open(product, id))
  orca.panels.handle('link.open', ({ text }) => openLink(text))

  orca.panels.handle('copyLink', async ({ product, id }) => {
    const { conn, status } = await resolve(orca, product)
    if (!conn) return { ok: false, message: notReady(status) }
    try {
      // The exact current title, not a cached one.
      const text =
        product === 'jira'
          ? await issue(fetch, conn, id).then((i) => readableLink(`${i.key}: ${i.summary}`, i.url))
          : await page(fetch, conn, id).then((p) => readableLink(p.title, p.url))
      return (await copyText(text)) ? { ok: true, message: 'Link copied.', text } : { ok: false, message: 'Could not reach the clipboard; copy the link below.', text }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })

  // Copy a link (Orca's link menu has Copy link), then press the shortcut: it opens in a tab here.
  orca.commands.register('open-copied-link', async () => {
    const text = await readText()
    if (!text?.trim()) return 'The clipboard is empty. Copy a Jira or Confluence link first.'
    const outcome = await openLink(text)
    return outcome.message
  })
}
