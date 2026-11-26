// Runs src/worker.ts's activate(orca) over a mock host, with Confluence faked through fetch and a
// temporary folder as the focused workspace.
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const BASE = 'https://wiki.example.com'
const PAGE = {
  id: '42',
  title: 'Basket design',
  space: { key: 'DOC', name: 'Docs' },
  version: { number: 3, when: '2026-11-20T10:00:00.000Z' },
  body: { storage: { value: '<h2>Scope</h2><p>Hello <strong>world</strong>.</p>' } },
  ancestors: [{ id: '1', title: 'Home' }]
}

function fakeConfluence(): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const path = String(url).replace(BASE, '')
    const body = path.startsWith('/rest/api/user/current')
      ? { displayName: 'Jane Doe', type: 'known' }
      : path.startsWith('/rest/api/content/search')
        ? { totalSize: 1, results: [PAGE] }
        : path.startsWith('/rest/api/content/42')
          ? PAGE
          : null
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 })
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

async function setupWorker(extra: { secrets?: Record<string, string> } = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'orca-confluence-'))
  const opened: unknown[] = []
  const host = mockHost({
    settings: { baseUrl: `${BASE}/`, auth: 'bearer', spaces: 'DOC', linkStyle: 'viewpage' },
    secrets: extra.secrets ?? { token: 'secret-token' },
    results: {
      'workspace.readContext': { workspaceId: 'w1', branch: 'main', displayName: 'ws', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'w1', kind: 'folder', name: 'ws', path: folder, branch: null, hostId: 'local' }], truncated: false },
      'editor.open': (params: unknown) => {
        opened.push(params)
        return { opened: true }
      }
    }
  })
  return { worker: await mountWorker(main, { host }), host, folder, opened }
}

test('reports the connection and signs in', async () => {
  const restore = fakeConfluence()
  const { worker } = await setupWorker()
  try {
    assert.deepEqual(await worker.request('conn.status'), { configured: true, hasToken: true, baseUrl: BASE })
    const tested = await worker.request('conn.test')
    assert.equal(tested.user, 'Jane Doe')
  } finally {
    restore()
    await worker.deactivate()
  }
})

test('asks for a token before searching', async () => {
  const { worker } = await setupWorker({ secrets: {} })
  const answer = await worker.request('search', { query: 'basket', space: '', cql: false })
  assert.equal(answer.results.length, 0)
  assert.ok(answer.error?.includes('token'))
  await worker.deactivate()
})

test('searches, and a page id goes straight to the page', async () => {
  const restore = fakeConfluence()
  const { worker } = await setupWorker()
  try {
    const found = await worker.request('search', { query: 'basket', space: 'DOC', cql: false })
    assert.equal(found.results[0].title, 'Basket design')
    const byId = await worker.request('search', { query: `${BASE}/pages/viewpage.action?pageId=42`, space: '', cql: false })
    assert.equal(byId.total, 1)
    assert.equal(byId.results[0].url, `${BASE}/pages/viewpage.action?pageId=42`)
  } finally {
    restore()
    await worker.deactivate()
  }
})

test('opens a page as a read-only Markdown copy, kept out of git', async () => {
  const restore = fakeConfluence()
  const { worker, folder, opened } = await setupWorker()
  try {
    const answer = await worker.request('page.open', { id: '42' })
    assert.equal(answer.ok, true)
    const relative = '.orca-confluence/pages/DOC/42-basket-design.md'
    assert.deepEqual(opened, [{ workspaceId: 'w1', path: relative }])
    const text = await fs.readFile(path.join(folder, relative), 'utf8')
    assert.ok(text.startsWith('---\nconfluence:\n  id: "42"\n'))
    assert.ok(text.includes('> Read-only copy of [Basket design](https://wiki.example.com/pages/viewpage.action?pageId=42)'))
    assert.ok(text.includes('> Home'))
    assert.ok(text.includes('# Basket design'))
    assert.ok(text.includes('## Scope'))
    assert.equal(await fs.readFile(path.join(folder, '.orca-confluence', '.gitignore'), 'utf8'), '*\n')
    assert.deepEqual((await worker.request('recent')).results.map((p) => p.id), ['42'])
    assert.equal(worker.posts.length, 1)
  } finally {
    restore()
    await worker.deactivate()
    await fs.rm(folder, { recursive: true, force: true })
  }
})
