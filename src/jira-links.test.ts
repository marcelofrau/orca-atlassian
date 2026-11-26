import { assert, test } from 'orca/testing'
import { jiraKeyIn, jqlFor, jqlPassthrough, projectKeys } from './jira-links'

test('finds a bare key, upper-cased', () => {
  assert.equal(jiraKeyIn('DOC-12'), 'DOC-12')
  assert.equal(jiraKeyIn('  doc-12\n'), 'DOC-12')
  assert.equal(jiraKeyIn('d2_x-7'), 'D2_X-7')
})

test('finds a key in the usual Jira URLs', () => {
  assert.equal(jiraKeyIn('https://jira.example.com/browse/doc-12'), 'DOC-12')
  assert.equal(jiraKeyIn('https://jira.example.com/browse/DOC-12?focusedCommentId=5'), 'DOC-12')
  assert.equal(jiraKeyIn('https://jira.example.com/secure/RapidBoard.jspa?rapidView=3&selectedIssue=DOC-12'), 'DOC-12')
  assert.equal(jiraKeyIn('https://example.atlassian.net/jira/software/projects/DOC/issues/DOC-12'), 'DOC-12')
  assert.equal(jiraKeyIn('https://jira.example.com/issues/?issueKey=DOC-12'), 'DOC-12')
})

test('only accepts URLs on the Jira host when a base is given', () => {
  const base = 'https://Jira.example.com/'
  assert.equal(jiraKeyIn('https://jira.EXAMPLE.com/browse/DOC-12', base), 'DOC-12')
  assert.equal(jiraKeyIn('https://other.example.org/browse/DOC-12', base), null)
  assert.equal(jiraKeyIn('DOC-12', base), 'DOC-12')
})

test('does not mistake other text for a key', () => {
  for (const text of ['UTF-8', 'ISO-8859', 'SHA-256', 'ES-2022', 'use UTF-8 here', 'see DOC-12 please', 'A-1', '12-3', 'DOC-', '', 'https://example.com/page']) {
    assert.equal(jiraKeyIn(text), null, text)
  }
})

test('builds JQL for an empty query, a key and free text', () => {
  assert.equal(jqlFor('', ''), 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC')
  assert.equal(jqlFor(' ', 'DOC'), 'project = "DOC" AND assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC')
  assert.equal(jqlFor('doc-12', 'DOC'), 'key = DOC-12')
  assert.equal(jqlFor('basket', ''), 'text ~ "basket" ORDER BY updated DESC')
  assert.equal(jqlFor('basket', 'DOC'), 'project = "DOC" AND text ~ "basket" ORDER BY updated DESC')
  assert.equal(jqlFor('say "hi" \\ there', ''), 'text ~ "say \\"hi\\" \\\\ there" ORDER BY updated DESC')
})

test('passes raw JQL through, adding the project only when it has none', () => {
  assert.equal(jqlPassthrough('status = Open', ''), 'status = Open')
  assert.equal(jqlPassthrough('status = Open', 'DOC'), 'project = "DOC" AND (status = Open)')
  assert.equal(jqlPassthrough('status = Open ORDER BY created', 'DOC'), 'project = "DOC" AND (status = Open) ORDER BY created')
  assert.equal(jqlPassthrough('order by created', 'DOC'), 'project = "DOC" order by created')
  assert.equal(jqlPassthrough('project = OTHER AND status = Open', 'DOC'), 'project = OTHER AND status = Open')
  assert.equal(jqlPassthrough('project in (A, B)', 'DOC'), 'project in (A, B)')
})

test('reads project keys from a setting', () => {
  assert.deepEqual(projectKeys('doc, abc;DOC  x_1'), ['DOC', 'ABC', 'X_1'])
  assert.deepEqual(projectKeys('1abc, a, DOC-1'), [])
  assert.deepEqual(projectKeys(undefined), [])
})
