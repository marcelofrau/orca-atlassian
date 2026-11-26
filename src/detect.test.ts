import { assert, test } from 'orca/testing'
import { detectLink } from './detect'

const bases = { confluence: 'https://wiki.example.com', jira: 'https://jira.example.com' }

test('finds Jira issues in links and bare keys', () => {
  assert.deepEqual(detectLink('https://jira.example.com/browse/DOC-12', bases), { product: 'jira', id: 'DOC-12' })
  assert.deepEqual(detectLink('  see https://jira.example.com/browse/doc-7?focusedId=1 please', bases), { product: 'jira', id: 'DOC-7' })
  assert.deepEqual(detectLink('DOC-12', bases), { product: 'jira', id: 'DOC-12' })
})

test('finds Confluence pages by id, URL and display link', () => {
  assert.deepEqual(detectLink('https://wiki.example.com/pages/viewpage.action?pageId=123456', bases), { product: 'confluence', id: '123456' })
  assert.deepEqual(detectLink('[Basket design](https://wiki.example.com/pages/viewpage.action?pageId=42000)', bases), { product: 'confluence', id: '42000' })
  assert.deepEqual(detectLink('https://wiki.example.com/display/DOC/Basket+design%3A+v2', bases), { product: 'confluence', space: 'DOC', title: 'Basket design: v2' })
  assert.deepEqual(detectLink('1234567', bases), { product: 'confluence', id: '1234567' })
})

test('ignores links to other hosts and plain text', () => {
  assert.equal(detectLink('https://github.com/acme/repo/pull/12', bases), null)
  assert.equal(detectLink('https://evil.example.org/pages/viewpage.action?pageId=1234', bases), null)
  assert.equal(detectLink('hello world', bases), null)
  assert.equal(detectLink('UTF-8', bases), null)
})

test('a product without a base URL is skipped', () => {
  assert.equal(detectLink('https://jira.example.com/browse/DOC-12', { confluence: bases.confluence, jira: '' }), null)
})
