// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { PageHit } from './protocol'

const hit: PageHit = {
  id: '42',
  title: 'Basket design',
  spaceKey: 'DOC',
  spaceName: 'Docs',
  url: 'https://wiki.example.com/pages/viewpage.action?pageId=42',
  version: 3,
  updatedAt: 0
}

test('asks for a token when not signed in', async () => {
  const host = mockHost({
    settings: { spaces: 'DOC' },
    requests: {
      'conn.status': () => ({ configured: true, hasToken: false, baseUrl: 'https://wiki.example.com' }),
      'conn.test': () => ({ configured: true, hasToken: false, baseUrl: 'https://wiki.example.com', error: 'Save a token first (Connection).' }),
      recent: () => ({ results: [] })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Save and test' }))
  assert.ok(!view.find({ type: 'Input', label: 'Search' }), 'no search box before signing in')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('searches, selects a page and opens it', async () => {
  const opened: string[] = []
  const host = mockHost({
    settings: { spaces: 'DOC, OPS' },
    requests: {
      'conn.status': () => ({ configured: true, hasToken: true, baseUrl: 'https://wiki.example.com' }),
      'conn.test': () => ({ configured: true, hasToken: true, baseUrl: 'https://wiki.example.com', user: 'Jane Doe' }),
      recent: () => ({ results: [] }),
      search: () => ({ results: [hit], total: 1 }),
      'page.open': ({ id }) => {
        opened.push(id)
        return { ok: true, message: 'Opened Basket design (version 3).' }
      }
    }
  })
  const view = await mount(panel, { host })
  await view.press({ text: 'Search' })
  assert.ok(view.find({ text: 'Open in tab' }), 'a single result is selected at once')
  await view.press({ text: 'Open in tab' })
  assert.deepEqual(opened, ['42'])
  assert.ok(view.find({ text: 'Opened Basket design (version 3).' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
