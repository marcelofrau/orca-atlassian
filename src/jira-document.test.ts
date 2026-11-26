import { assert, test } from 'orca/testing'
import type { Issue } from './jira'
import { issueDocument } from './jira-document'

const strip = (html: string) => html.replace(/<[^>]+>/g, '')
const keepHtml = (html: string) => html
const base = 'https://jira.example.com'
const fetchedAt = new Date('2026-11-26T09:05:30.000Z')

function make(extra: Partial<Issue> = {}): Issue {
  return {
    key: 'DOC-12',
    summary: 'Basket [design]',
    status: 'Open',
    type: 'Story',
    assignee: 'Ada Example',
    updatedAt: Date.parse('2026-11-20T10:00:00.000Z'),
    url: `${base}/browse/DOC-12`,
    priority: 'High',
    reporter: '',
    resolution: '',
    createdAt: Date.parse('2026-11-01T08:00:00.000Z'),
    due: '2026-12-01',
    labels: ['a', 'b'],
    components: [],
    fixVersions: ['1.2'],
    parent: { key: 'DOC-1', summary: 'Epic' },
    descriptionHtml: '<p>Hello</p>',
    descriptionText: 'Hello',
    subtasks: [],
    links: [],
    attachments: [],
    comments: [],
    commentTotal: 0,
    ...extra
  }
}

test('writes the full document for a rich issue', () => {
  const doc = issueDocument(
    make({
      subtasks: [{ key: 'DOC-13', summary: 'Sub', status: 'Done' }],
      links: [
        { relation: 'blocks', key: 'DOC-20', summary: 'A', status: 'Open' },
        { relation: 'is blocked by', key: 'DOC-21', summary: 'B', status: 'Done' },
        { relation: 'blocks', key: 'DOC-22', summary: 'C', status: 'Open' }
      ],
      attachments: [
        { filename: 'a.png', size: 2048, url: `${base}/secure/attachment/1/a.png`, author: 'Ada Example', createdAt: Date.parse('2026-11-02T00:00:00.000Z') },
        { filename: 'b.zip', size: 20 * 1024, url: `${base}/b`, author: 'Bob', createdAt: 0 },
        { filename: 'c.mov', size: 3 * 1024 * 1024, url: `${base}/c`, author: 'Bob', createdAt: 0 }
      ],
      comments: [{ author: 'Bob', createdAt: Date.parse('2026-11-03T09:30:00.000Z'), bodyHtml: '<p>first</p>', bodyText: 'first' }],
      commentTotal: 1
    }),
    { baseUrl: `${base}/` },
    fetchedAt,
    strip
  )
  const expected = [
    '---',
    'jira:',
    '  key: "DOC-12"',
    '  summary: "Basket [design]"',
    '  status: "Open"',
    `  url: "${base}/browse/DOC-12"`,
    '  updated: "2026-11-20"',
    '  fetched: "2026-11-26T09:05:30.000Z"',
    '---',
    '',
    `> Read-only copy of [DOC-12: Basket \\[design\\]](${base}/browse/DOC-12), fetched 2026-11-26 09:05 UTC. Edits here are not sent to Jira; open it again to refresh.`,
    '',
    '# DOC-12: Basket [design]',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| Type | Story |',
    '| Status | Open |',
    '| Priority | High |',
    '| Assignee | Ada Example |',
    '| Created | 2026-11-01 |',
    '| Updated | 2026-11-20 |',
    '| Due | 2026-12-01 |',
    '| Labels | a, b |',
    '| Fix versions | 1.2 |',
    `| Parent | [DOC-1: Epic](${base}/browse/DOC-1) |`,
    '',
    '## Description',
    '',
    'Hello',
    '',
    '## Sub-tasks',
    '',
    `- [DOC-13](${base}/browse/DOC-13) Sub · Done`,
    '',
    '## Linked issues',
    '',
    '**blocks**:',
    '',
    `- [DOC-20](${base}/browse/DOC-20) A · Open`,
    `- [DOC-22](${base}/browse/DOC-22) C · Open`,
    '',
    '**is blocked by**:',
    '',
    `- [DOC-21](${base}/browse/DOC-21) B · Done`,
    '',
    '## Attachments',
    '',
    `- [a.png](${base}/secure/attachment/1/a.png) · 2.0 KB · Ada Example · 2026-11-02`,
    `- [b.zip](${base}/b) · 20 KB · Bob · `,
    `- [c.mov](${base}/c) · 3.0 MB · Bob · `,
    '',
    '## Comments (1)',
    '',
    '### Bob · 2026-11-03 09:30',
    '',
    'first',
    ''
  ].join('\n')
  assert.equal(doc, expected)
})

test('makes relative links and images absolute before converting', () => {
  const html = `<a href="/browse/DOC-1">x</a><img src='/secure/a.png'><a href="//cdn.example.com/x">y</a><a href="https://other.example.org/z">z</a>`
  const doc = issueDocument(make({ descriptionHtml: html }), { baseUrl: base }, fetchedAt, keepHtml)
  assert.ok(doc.includes(`href="${base}/browse/DOC-1"`))
  assert.ok(doc.includes(`src='${base}/secure/a.png'`))
  assert.ok(doc.includes('href="//cdn.example.com/x"'))
  assert.ok(doc.includes('href="https://other.example.org/z"'))
})

test('falls back to the raw description, then to a note', () => {
  const raw = issueDocument(make({ descriptionHtml: '', descriptionText: 'h1. Plain *text*' }), { baseUrl: base }, fetchedAt, strip)
  assert.ok(raw.includes('## Description\n\nh1. Plain *text*\n'))
  const none = issueDocument(make({ descriptionHtml: '', descriptionText: '' }), { baseUrl: base }, fetchedAt, strip)
  assert.ok(none.includes('## Description\n\n*No description.*\n'))
  assert.ok(!none.includes('## Sub-tasks'))
  assert.ok(!none.includes('## Comments'))
  assert.ok(none.endsWith('*No description.*\n'))
})

test('says when only some comments are shown', () => {
  const doc = issueDocument(
    make({ comments: [{ author: 'Bob', createdAt: 0, bodyHtml: '', bodyText: 'plain body' }], commentTotal: 7 }),
    { baseUrl: base },
    fetchedAt,
    strip
  )
  assert.ok(doc.includes('## Comments (7)'))
  assert.ok(doc.includes('plain body'))
  assert.ok(doc.endsWith('*Showing 1 of 7 comments; the rest are in Jira.*\n'))
  assert.ok(!doc.endsWith('\n\n'))
})

test('escapes pipes in table values', () => {
  const doc = issueDocument(make({ labels: ['a|b'], type: 'Bug | Story' }), { baseUrl: base }, fetchedAt, strip)
  assert.ok(doc.includes('| Type | Bug \\| Story |'))
  assert.ok(doc.includes('| Labels | a\\|b |'))
})
