import { assert, test } from 'orca/testing'
import { normaliseBase, pageFileName, pageIdIn, pageUrl, readableLink, searchCql, spaceKeys } from './links'

test('normalises the base URL', () => {
  assert.equal(normaliseBase(' https://wiki.example.com/ '), 'https://wiki.example.com')
  assert.equal(normaliseBase('https://acme.atlassian.net/wiki//'), 'https://acme.atlassian.net/wiki')
  assert.equal(normaliseBase('wiki.example.com'), '')
  assert.equal(normaliseBase(42), '')
})

test('builds page URLs in either style', () => {
  assert.equal(pageUrl('https://w.example', '123', 'viewpage'), 'https://w.example/pages/viewpage.action?pageId=123')
  assert.equal(pageUrl('https://w.example/wiki', '9', 'webui', '/spaces/DOC/pages/9/Title'), 'https://w.example/wiki/spaces/DOC/pages/9/Title')
  assert.equal(pageUrl('https://w.example', '9', 'webui'), 'https://w.example/pages/viewpage.action?pageId=9')
})

test('writes readable links with the exact title', () => {
  assert.equal(readableLink('Release [v2] notes', 'https://w.example/x?a=1'), '[Release \\[v2\\] notes](https://w.example/x?a=1)')
  assert.equal(readableLink('A', 'https://w.example/a (b)'), '[A](https://w.example/a%20(b%29)')
})

test('finds a page id in what was typed', () => {
  assert.equal(pageIdIn('1234567890'), '1234567890')
  assert.equal(pageIdIn('https://w.example/pages/viewpage.action?pageId=55&x=1'), '55')
  assert.equal(pageIdIn('https://acme.atlassian.net/wiki/spaces/DOC/pages/987654/Title'), '987654')
  assert.equal(pageIdIn('release 2024'), null)
  assert.equal(pageIdIn('12'), null)
})

test('builds CQL for text, empty and raw queries', () => {
  assert.equal(searchCql('basket "v2"', 'DOC', false), 'type = page AND space = "DOC" AND (title ~ "basket \\"v2\\"" OR text ~ "basket \\"v2\\"")')
  assert.equal(searchCql('  ', '', false), 'type = page ORDER BY lastmodified DESC')
  assert.equal(searchCql('label = arch', 'DOC', true), '(label = arch) AND space = "DOC"')
  assert.equal(searchCql('space = OPS and label = x', 'DOC', true), 'space = OPS and label = x')
})

test('parses the space keys setting', () => {
  assert.deepEqual(spaceKeys('doc, OPS  ~jdoe;doc bad-key'), ['DOC', 'OPS', '~JDOE'])
  assert.deepEqual(spaceKeys(undefined), [])
})

test('names page files safely', () => {
  assert.equal(pageFileName('42', 'Café: Ünïcode / Design?'), '42-cafe-unicode-design.md')
  assert.ok(pageFileName('1', 'x'.repeat(200)).length <= 83)
})
