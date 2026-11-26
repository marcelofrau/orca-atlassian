import { assert, test } from 'orca/testing'
import { authorization, ConfluenceError, currentUser, page, search, type Connection } from './confluence'

const conn: Connection = { baseUrl: 'https://wiki.example.com', auth: 'bearer', email: '', token: 'secret-token', linkStyle: 'viewpage' }

function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>, seen: { url: string; auth: string }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: String((init?.headers as Record<string, string>)?.Authorization ?? '') })
    const path = url.replace(conn.baseUrl, '')
    const route = Object.entries(routes).find(([prefix]) => path.startsWith(prefix))?.[1] ?? { status: 404, body: {} }
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

test('sends a bearer token, or e-mail and token for Cloud', () => {
  assert.equal(authorization(conn), 'Bearer secret-token')
  assert.equal(authorization({ ...conn, auth: 'basic', email: 'me@example.com', token: 'abc' }), `Basic ${Buffer.from('me@example.com:abc').toString('base64')}`)
})

test('maps search results to page hits', async () => {
  const seen: { url: string; auth: string }[] = []
  const fetch = fakeFetch(
    {
      '/rest/api/content/search': {
        body: {
          totalSize: 7,
          _links: { base: 'https://wiki.example.com' },
          results: [{ id: '42', title: 'Basket design', space: { key: 'DOC', name: 'Docs' }, version: { number: 3, when: '2026-11-20T10:00:00.000Z' }, _links: { webui: '/display/DOC/Basket+design' } }]
        }
      }
    },
    seen
  )
  const answer = await search(fetch, conn, 'type = page AND space = "DOC"')
  assert.equal(answer.total, 7)
  assert.deepEqual(answer.results[0], {
    id: '42',
    title: 'Basket design',
    spaceKey: 'DOC',
    spaceName: 'Docs',
    url: 'https://wiki.example.com/pages/viewpage.action?pageId=42',
    version: 3,
    updatedAt: Date.parse('2026-11-20T10:00:00.000Z')
  })
  assert.ok(seen[0].url.includes('cql=type%20%3D%20page%20AND%20space%20%3D%20%22DOC%22'))
  assert.equal(seen[0].auth, 'Bearer secret-token')
})

test('uses the pretty URL when the link style asks for it', async () => {
  const fetch = fakeFetch({ '/rest/api/content/search': { body: { _links: { base: 'https://wiki.example.com' }, results: [{ id: '9', title: 'T', _links: { webui: '/display/DOC/T' } }] } } })
  const answer = await search(fetch, { ...conn, linkStyle: 'webui' }, 'x')
  assert.equal(answer.results[0].url, 'https://wiki.example.com/display/DOC/T')
})

test('reads a page with its body and ancestors', async () => {
  const fetch = fakeFetch({
    '/rest/api/content/42': {
      body: { id: '42', title: 'Basket', space: { key: 'DOC' }, version: { number: 5 }, body: { storage: { value: '<p>Hi</p>' } }, ancestors: [{ id: '1', title: 'Home' }] }
    }
  })
  const p = await page(fetch, conn, '42')
  assert.equal(p.storage, '<p>Hi</p>')
  assert.deepEqual(p.ancestors, [{ id: '1', title: 'Home' }])
  assert.equal(p.version, 5)
})

test('explains refusals without echoing the token', async () => {
  const fetch = fakeFetch({ '/rest/api/user/current': { status: 401 } })
  try {
    await currentUser(fetch, conn)
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof ConfluenceError)
    assert.equal((error as ConfluenceError).status, 401)
    assert.ok(!(error as Error).message.includes('secret-token'))
  }
})

test('refuses ids that are not numbers before calling out', async () => {
  const seen: { url: string; auth: string }[] = []
  try {
    await page(fakeFetch({}, seen), conn, '../admin')
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof ConfluenceError)
  }
  assert.equal(seen.length, 0)
})
