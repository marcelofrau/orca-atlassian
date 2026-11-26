// The plugin's worker: it holds the token, talks to Confluence and writes the page copies.
// Orca starts it on the panel's first request and transpiles this file itself.
import type { OrcaWorkerApi } from 'orca/worker'
import { copyText } from './clipboard'
import { ConfluenceError, currentUser, page, search, type Connection } from './confluence'
import { normaliseBase, pageFileName, pageIdIn, readableLink, searchCql, type LinkStyle } from './links'
import type { ConnectionStatus, Outcome, PageHit } from './protocol'
import { storageToMarkdown } from './storage-to-markdown'
import { focusedWorkspace, writeTabFile } from './tab-file'

const TOKEN = 'token'
const RECENT = 'recent'
const RECENT_MAX = 20

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function connection(orca: OrcaWorkerApi): Promise<{ conn: Connection | null; status: ConnectionStatus }> {
  const settings = await orca.settings.get()
  const baseUrl = normaliseBase(settings.baseUrl)
  const auth = settings.auth === 'basic' ? 'basic' : 'bearer'
  const email = typeof settings.email === 'string' ? settings.email.trim() : ''
  const token = (await orca.secrets.get(TOKEN)) ?? ''
  const linkStyle: LinkStyle = settings.linkStyle === 'webui' ? 'webui' : 'viewpage'
  const configured = Boolean(baseUrl) && (auth === 'bearer' || Boolean(email))
  const status: ConnectionStatus = { configured, hasToken: Boolean(token), baseUrl }
  return { conn: configured && token ? { baseUrl, auth, email, token, linkStyle } : null, status }
}

function notReady(status: ConnectionStatus): string {
  if (!status.baseUrl) return 'Set the Confluence base URL first (Connection, or Settings → Plugins → Confluence).'
  if (!status.configured) return 'Confluence Cloud needs your Atlassian e-mail too (Connection, or Settings).'
  return 'Save a token first (Connection).'
}

async function test(orca: OrcaWorkerApi): Promise<ConnectionStatus> {
  const { conn, status } = await connection(orca)
  if (!conn) return { ...status, error: notReady(status) }
  try {
    return { ...status, user: await currentUser(fetch, conn) }
  } catch (error) {
    return { ...status, error: message(error) }
  }
}

async function remember(orca: OrcaWorkerApi, entry: PageHit): Promise<PageHit[]> {
  const stored = await orca.storage.get(RECENT)
  const list = (Array.isArray(stored) ? (stored as unknown as PageHit[]) : []).filter((p) => p?.id !== entry.id)
  const results = [entry, ...list].slice(0, RECENT_MAX)
  await orca.storage.set(RECENT, results as unknown as never)
  return results
}

const yaml = (value: string | number) => (typeof value === 'number' ? String(value) : JSON.stringify(value))
const day = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'unknown')

/** The tab's Markdown: front matter for later tools, a note that it is a copy, then the page. */
export function pageDocument(p: { id: string; title: string; spaceKey: string; url: string; version: number; updatedAt: number; ancestors: { title: string }[] }, body: string, fetchedAt: Date): string {
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

  orca.panels.handle('conn.status', async () => (await connection(orca)).status)
  orca.panels.handle('conn.test', () => test(orca))
  orca.panels.handle('conn.setToken', async ({ token }) => {
    const value = token.trim()
    if (!value) return { ...(await connection(orca)).status, error: 'The token is empty.' }
    await orca.secrets.set(TOKEN, value)
    return test(orca)
  })
  orca.panels.handle('conn.clearToken', async () => {
    await orca.secrets.delete(TOKEN)
    return (await connection(orca)).status
  })

  orca.panels.handle('search', async ({ query, space, cql }) => {
    const { conn, status } = await connection(orca)
    if (!conn) return { results: [], total: 0, error: notReady(status) }
    try {
      const id = cql ? null : pageIdIn(query)
      if (id) {
        return { results: [strip(await page(fetch, conn, id))], total: 1 }
      }
      return await search(fetch, conn, searchCql(query, space, cql))
    } catch (error) {
      return { results: [], total: 0, error: message(error) }
    }
  })

  orca.panels.handle('recent', async () => {
    const stored = await orca.storage.get(RECENT)
    return { results: Array.isArray(stored) ? (stored as unknown as PageHit[]) : [] }
  })

  orca.panels.handle('page.open', async ({ id }): Promise<Outcome> => {
    const { conn, status } = await connection(orca)
    if (!conn) return { ok: false, message: notReady(status) }
    try {
      const workspace = await focusedWorkspace(call)
      if (!workspace) return { ok: false, message: 'Open a local workspace first; pages open in a tab there.' }
      const found = await page(fetch, conn, id)
      const body = storageToMarkdown(found.storage, { baseUrl: conn.baseUrl, spaceKey: found.spaceKey, pageUrl: found.url })
      const relative = await writeTabFile(workspace.path, `pages/${found.spaceKey || 'page'}/${pageFileName(found.id, found.title)}`, pageDocument(found, body, new Date()))
      await call('editor.open', { workspaceId: workspace.id, path: relative })
      orca.panels.post('recent.changed', { results: await remember(orca, strip(found)) })
      return { ok: true, message: `Opened ${found.title} (version ${found.version}).` }
    } catch (error) {
      return { ok: false, message: error instanceof ConfluenceError ? error.message : `Could not open the page: ${message(error)}` }
    }
  })

  orca.panels.handle('page.copyLink', async ({ id }) => {
    const { conn, status } = await connection(orca)
    if (!conn) return { ok: false, message: notReady(status) }
    try {
      const found = await page(fetch, conn, id) // the exact current title, not a cached one
      const text = readableLink(found.title, found.url)
      const copied = await copyText(text)
      return copied ? { ok: true, message: 'Link copied.', text } : { ok: false, message: 'Could not reach the clipboard; copy the link below.', text }
    } catch (error) {
      return { ok: false, message: message(error) }
    }
  })
}

function strip(p: PageHit & { storage?: unknown; ancestors?: unknown }): PageHit {
  return { id: p.id, title: p.title, spaceKey: p.spaceKey, spaceName: p.spaceName, url: p.url, version: p.version, updatedAt: p.updatedAt }
}
