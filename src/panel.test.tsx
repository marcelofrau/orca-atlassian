// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Hit, Product } from './protocol'

const page: Hit = {
  product: 'confluence',
  id: '42',
  title: 'Basket design',
  detail: 'Docs · v3',
  url: 'https://wiki.example.com/pages/viewpage.action?pageId=42',
  updatedAt: 0
}

const signedIn = (product: Product) => ({ product, configured: true, hasToken: true, baseUrl: 'https://wiki.example.com', user: 'Jane Doe' })

test('asks for a token when not signed in', async () => {
  const host = mockHost({
    requests: {
      'conn.status': ({ product }) => ({ product, configured: true, hasToken: false, baseUrl: 'https://wiki.example.com' }),
      'conn.test': ({ product }) => ({ product, configured: true, hasToken: false, baseUrl: 'https://wiki.example.com', error: 'Save a token first.' }),
      scopes: () => ({ keys: [] }),
      recent: () => ({ results: [] })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Save and test' }))
  assert.ok(!view.find({ type: 'Input', label: 'Search Confluence' }), 'no search box before signing in')
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('searches, selects a page and opens it', async () => {
  const opened: string[] = []
  const host = mockHost({
    requests: {
      'conn.status': ({ product }) => signedIn(product),
      'conn.test': ({ product }) => signedIn(product),
      scopes: () => ({ keys: ['DOC'] }),
      recent: () => ({ results: [] }),
      search: () => ({ results: [page], total: 1 }),
      open: ({ id }) => {
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
