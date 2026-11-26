// Runs src/worker.ts's activate(orca) over a mock host, with Confluence and Jira faked through
// fetch and a temporary folder as the focused workspace.
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const WIKI = 'https://wiki.example.com'
const JIRA = 'https://jira.example.com'
const PAGE = {
  id: '42',
  title: 'Basket design',
  space: { key: 'DOC', name: 'Docs' },
  version: { number: 3, when: '2026-11-20T10:00:00.000Z' },
  body: { storage: { value: '<h2>Scope</h2><p>Hello <strong>world</strong>.</p>' } },
  ancestors: [{ id: '1', title: 'Home' }],
  _links: { webui: '/display/DOC/Basket+design' }
}
const ISSUE = {
  key: 'DOC-12',
  fields: {
    summary: 'Fix the basket total',
    status: { name: 'In Progress' },
    issuetype: { name: 'Bug' },
    assignee: { displayName: 'Jane Doe' },
    reporter: { displayName: 'John Roe' },
    created: '2026-11-01T09:00:00.000+0000',
    updated: '2026-11-20T10:00:00.000+0000',
    description: 'Totals are off by one.',
    comment: { comments: [{ author: { displayName: 'John Roe' }, created: '2026-11-02T09:00:00.000+0000', body: 'Seen it too.' }], total: 1 }
  },
  renderedFields: {
    description: '<p>Totals are <b>off</b> by one, see <a href="/browse/DOC-11">DOC-11</a>.</p>',
    comment: { comments: [{ body: '<p>Seen it too.</p>' }] }
  }
}

function fakeAtlassian(): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const u = String(url)
    let body: unknown = null
    if (u.startsWith(WIKI)) {
      const p = u.slice(WIKI.length)
      if (p.startsWith('/rest/api/user/current')) body = { displayName: 'Jane Doe', type: 'known' }
      else if (p.startsWith('/rest/api/content/search')) body = { totalSize: 1, results: [PAGE], _links: { base: WIKI } }
      else if (p.startsWith('/rest/api/content/42')) body = { ...PAGE, _links: { ...PAGE._links, base: WIKI } }
    } else if (u.startsWith(JIRA)) {
      const p = u.slice(JIRA.length)
      if (p.startsWith('/rest/api/2/myself')) body = { displayName: 'Jane Doe' }
      else if (p.startsWith('/rest/api/2/issue/DOC-12')) body = ISSUE
      else if (p.startsWith('/rest/api/2/search')) body = { total: 1, issues: [ISSUE] }
    }
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 })
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

async function setupWorker(secrets: Record<string, string> = { confluenceToken: 'c-token', jiraToken: 'j-token' }) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'orca-atlassian-'))
  const opened: { path: string }[] = []
  const host = mockHost({
    settings: { confluenceUrl: `${WIKI}/`, confluenceSpaces: 'DOC', jiraUrl: JIRA, jiraProjects: 'doc, ops' },
    secrets,
    results: {
      'workspace.readContext': { workspaceId: 'w1', branch: 'main', displayName: 'ws', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'w1', kind: 'folder', name: 'ws', path: folder, branch: null, hostId: 'local' }], truncated: false },
      'editor.open': (params: { path: string }) => {
        opened.push(params)
        return { opened: true }
      }
    }
  })
  return { worker: await mountWorker(main, { host }), folder, opened }
}

test('reports both connections and signs in', async () => {
  const restore = fakeAtlassian()
  const { worker } = await setupWorker()
  try {
    assert.deepEqual(await worker.request('conn.status', { product: 'confluence' }), { product: 'confluence', configured: true, hasToken: true, baseUrl: WIKI })
    assert.equal((await worker.request('conn.test', { product: 'jira' })).user, 'Jane Doe')
    assert.deepEqual(await worker.request('scopes', { product: 'jira' }), { keys: ['DOC', 'OPS'] })
  } finally {
    restore()
    await worker.deactivate()
  }
})

test('asks for the right token before searching', async () => {
  const { worker } = await setupWorker({ confluenceToken: 'c-token' })
  const answer = await worker.request('search', { product: 'jira', query: 'basket', scope: '', raw: false })
  assert.equal(answer.results.length, 0)
  assert.ok(answer.error?.includes('Jira token'))
  await worker.deactivate()
})

test('searches Confluence and Jira, and a key or id goes straight to it', async () => {
  const restore = fakeAtlassian()
  const { worker } = await setupWorker()
  try {
    assert.equal((await worker.request('search', { product: 'confluence', query: 'basket', scope: 'DOC', raw: false })).results[0].title, 'Basket design')
    const byKey = await worker.request('search', { product: 'jira', query: 'doc-12', scope: '', raw: false })
    assert.deepEqual(byKey.results.map((h) => [h.id, h.title]), [['DOC-12', 'DOC-12: Fix the basket total']])
  } finally {
    restore()
    await worker.deactivate()
  }
})

test('opens a page and an issue as read-only Markdown copies, kept out of git', async () => {
  const restore = fakeAtlassian()
  const { worker, folder, opened } = await setupWorker()
  try {
    assert.equal((await worker.request('open', { product: 'confluence', id: '42' })).ok, true)
    const pageFile = '.orca-atlassian/confluence/DOC/42-basket-design.md'
    const pageText = await fs.readFile(path.join(folder, pageFile), 'utf8')
    assert.ok(pageText.includes('> Read-only copy of [Basket design](https://wiki.example.com/pages/viewpage.action?pageId=42)'))
    assert.ok(pageText.includes('## Scope'))

    assert.equal((await worker.request('link.open', { text: `${JIRA}/browse/DOC-12` })).ok, true)
    const issueFile = '.orca-atlassian/jira/DOC/DOC-12.md'
    const issueText = await fs.readFile(path.join(folder, issueFile), 'utf8')
    assert.ok(issueText.includes('# DOC-12: Fix the basket total'))
    assert.ok(issueText.includes('https://jira.example.com/browse/DOC-11'), 'relative links point at Jira')

    assert.deepEqual(opened.map((o) => o.path), [pageFile, issueFile])
    assert.equal(await fs.readFile(path.join(folder, '.orca-atlassian', '.gitignore'), 'utf8'), '*\n')
    assert.deepEqual((await worker.request('recent')).results.map((h) => h.id), ['DOC-12', '42'])
  } finally {
    restore()
    await worker.deactivate()
    await fs.rm(folder, { recursive: true, force: true })
  }
})

test('opens display links by title and refuses other hosts', async () => {
  const restore = fakeAtlassian()
  const { worker, folder } = await setupWorker()
  try {
    assert.equal((await worker.request('link.open', { text: `${WIKI}/display/DOC/Basket+design` })).ok, true)
    const other = await worker.request('link.open', { text: 'https://github.com/acme/repo' })
    assert.equal(other.ok, false)
  } finally {
    restore()
    await worker.deactivate()
    await fs.rm(folder, { recursive: true, force: true })
  }
})
