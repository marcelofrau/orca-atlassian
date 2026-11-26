import { assert, test } from 'orca/testing'
import { issue, JiraError, jiraAuthorization, myself, searchIssues, type JiraConnection } from './jira'

const conn: JiraConnection = { baseUrl: 'https://jira.example.com', auth: 'bearer', email: '', token: 'secret-token' }

function fakeFetch(routes: Record<string, { status?: number; body?: unknown }>, seen: { url: string; auth: string }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: String((init?.headers as Record<string, string>)?.Authorization ?? '') })
    const path = url.replace(conn.baseUrl, '')
    const route = Object.entries(routes).find(([prefix]) => path.startsWith(prefix))?.[1] ?? { status: 404, body: {} }
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

test('sends a bearer token, or e-mail and token for Cloud', () => {
  assert.equal(jiraAuthorization(conn), 'Bearer secret-token')
  assert.equal(jiraAuthorization({ ...conn, auth: 'basic', email: 'me@example.com', token: 'abc' }), `Basic ${Buffer.from('me@example.com:abc').toString('base64')}`)
})

test('reads the display name of the current user', async () => {
  const seen: { url: string; auth: string }[] = []
  const name = await myself(fakeFetch({ '/rest/api/2/myself': { body: { displayName: 'Ada Example' } } }, seen), conn)
  assert.equal(name, 'Ada Example')
  assert.equal(seen[0].auth, 'Bearer secret-token')
})

test('maps search results to issue hits', async () => {
  const seen: { url: string; auth: string }[] = []
  const fetch = fakeFetch(
    {
      '/rest/api/2/search': {
        body: {
          total: 4,
          issues: [
            {
              key: 'DOC-12',
              fields: { summary: 'Basket design', status: { name: 'Open' }, issuetype: { name: 'Story' }, assignee: { name: 'ada' }, updated: '2026-11-20T10:00:00.000+0000' }
            },
            { key: 'DOC-13', fields: null }
          ]
        }
      }
    },
    seen
  )
  const answer = await searchIssues(fetch, conn, 'project = "DOC"', 10)
  assert.equal(answer.total, 4)
  assert.deepEqual(answer.results[0], {
    key: 'DOC-12',
    summary: 'Basket design',
    status: 'Open',
    type: 'Story',
    assignee: 'ada',
    updatedAt: Date.parse('2026-11-20T10:00:00.000+0000'),
    url: 'https://jira.example.com/browse/DOC-12'
  })
  assert.equal(answer.results[1].summary, '')
  assert.equal(answer.results[1].updatedAt, 0)
  assert.ok(seen[0].url.includes('jql=project%20%3D%20%22DOC%22&maxResults=10'))
})

test('maps an issue with rendered comments, parent, links, sub-tasks and attachments', async () => {
  const fetch = fakeFetch({
    '/rest/api/2/issue/DOC-12': {
      body: {
        key: 'DOC-12',
        renderedFields: { description: '<p>Hello</p>', comment: { comments: [{ body: '<p>first</p>' }, { body: '<p>second</p>' }] } },
        fields: {
          summary: 'Basket design',
          status: { name: 'Open' },
          issuetype: { name: 'Story' },
          priority: { name: 'High' },
          assignee: { displayName: 'Ada Example' },
          reporter: { name: 'bob' },
          resolution: null,
          created: '2026-11-01T08:00:00.000Z',
          updated: '2026-11-20T10:00:00.000Z',
          duedate: '2026-12-01',
          labels: ['a', 'b'],
          components: [{ name: 'Cart' }],
          fixVersions: [{ name: '1.2' }],
          parent: { key: 'DOC-1', fields: { summary: 'Epic' } },
          description: 'h1. Hello',
          subtasks: [{ key: 'DOC-13', fields: { summary: 'Sub', status: { name: 'Done' } } }],
          issuelinks: [
            { type: { outward: 'blocks', inward: 'is blocked by' }, outwardIssue: { key: 'DOC-20', fields: { summary: 'Out', status: { name: 'Open' } } } },
            { type: { outward: 'blocks', inward: 'is blocked by' }, inwardIssue: { key: 'DOC-21', fields: { summary: 'In', status: { name: 'Done' } } } },
            { type: { outward: 'blocks' } }
          ],
          attachment: [{ filename: 'a.png', size: 2048, content: 'https://jira.example.com/secure/attachment/1/a.png', author: { displayName: 'Ada Example' }, created: '2026-11-02T00:00:00.000Z' }],
          comment: {
            total: 5,
            comments: [
              { author: { displayName: 'Bob' }, created: '2026-11-03T09:30:00.000Z', body: 'one' },
              { author: { name: 'cy' }, created: 'not a date', body: 'two' }
            ]
          }
        }
      }
    }
  })
  const found = await issue(fetch, conn, 'doc-12')
  assert.equal(found.key, 'DOC-12')
  assert.equal(found.url, 'https://jira.example.com/browse/DOC-12')
  assert.equal(found.priority, 'High')
  assert.equal(found.assignee, 'Ada Example')
  assert.equal(found.reporter, 'bob')
  assert.equal(found.resolution, '')
  assert.equal(found.due, '2026-12-01')
  assert.deepEqual(found.labels, ['a', 'b'])
  assert.deepEqual(found.components, ['Cart'])
  assert.deepEqual(found.fixVersions, ['1.2'])
  assert.deepEqual(found.parent, { key: 'DOC-1', summary: 'Epic' })
  assert.equal(found.descriptionHtml, '<p>Hello</p>')
  assert.equal(found.descriptionText, 'h1. Hello')
  assert.deepEqual(found.subtasks, [{ key: 'DOC-13', summary: 'Sub', status: 'Done' }])
  assert.deepEqual(found.links, [
    { relation: 'blocks', key: 'DOC-20', summary: 'Out', status: 'Open' },
    { relation: 'is blocked by', key: 'DOC-21', summary: 'In', status: 'Done' }
  ])
  assert.deepEqual(found.attachments, [
    { filename: 'a.png', size: 2048, url: 'https://jira.example.com/secure/attachment/1/a.png', author: 'Ada Example', createdAt: Date.parse('2026-11-02T00:00:00.000Z') }
  ])
  assert.equal(found.comments.length, 2)
  assert.equal(found.comments[0].bodyHtml, '<p>first</p>')
  assert.equal(found.comments[0].bodyText, 'one')
  assert.equal(found.comments[1].bodyHtml, '<p>second</p>')
  assert.equal(found.comments[1].author, 'cy')
  assert.equal(found.comments[1].createdAt, 0)
  assert.equal(found.commentTotal, 5)
})

test('copes with an issue that has almost nothing', async () => {
  const found = await issue(fakeFetch({ '/rest/api/2/issue/DOC-1': { body: { key: 'DOC-1' } } }), conn, 'DOC-1')
  assert.equal(found.summary, '')
  assert.equal(found.parent, undefined)
  assert.deepEqual(found.comments, [])
  assert.equal(found.commentTotal, 0)
})

test('refuses keys that are not keys before calling out', async () => {
  const seen: { url: string; auth: string }[] = []
  const fetch = fakeFetch({}, seen)
  for (const bad of ['', 'DOC', '12', 'DOC-12/../x', '1A-2']) {
    try {
      await issue(fetch, conn, bad)
      assert.fail('expected a refusal')
    } catch (error) {
      assert.ok(error instanceof JiraError)
    }
  }
  assert.equal(seen.length, 0)
})

test('explains refusals without echoing the token', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    try {
      await myself(fakeFetch({ '/rest/api/2/myself': { status } }), conn)
      assert.fail('expected a refusal')
    } catch (error) {
      assert.ok(error instanceof JiraError)
      assert.equal((error as JiraError).status, status)
      assert.ok(!(error as Error).message.includes('secret-token'))
    }
  }
})

test('says so when the answer is not JSON or the host is unreachable', async () => {
  const html = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch
  await assert.rejects(() => myself(html, conn), /did not answer with JSON/)
  const down = (async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
  }) as unknown as typeof fetch
  await assert.rejects(() => myself(down, conn), /Could not reach https:\/\/jira\.example\.com \(ENOTFOUND\)/)
})
