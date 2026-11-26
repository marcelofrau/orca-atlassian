import { assert, test } from 'orca/testing'
import { storageToMarkdown } from './storage-to-markdown'

const ctx = { baseUrl: 'https://wiki.example.com', spaceKey: 'DOC', pageUrl: 'https://wiki.example.com/pages/viewpage.action?pageId=42' }
const md = (s: string) => storageToMarkdown(s, ctx)

test('empty input gives an empty string', () => {
  assert.equal(md(''), '')
  assert.equal(md('  <p> </p> '), '')
})

test('headings and paragraphs are separated by one blank line', () => {
  assert.equal(md('<h1>Title</h1><p>Hello</p><h3>Sub</h3>'), '# Title\n\nHello\n\n### Sub\n')
})

test('inline formatting, empty bold and code with backticks', () => {
  assert.equal(
    md('<p><strong>b</strong> <em>i</em> <s>x</s> <b> </b><u>u</u> <code>a`b</code></p>'),
    '**b** *i* ~~x~~ u ``a`b``\n',
  )
})

test('whitespace runs collapse in normal text', () => {
  assert.equal(md('<p>a   \n  b\t\tc</p>'), 'a b c\n')
})

test('br becomes a hard break and hr a rule', () => {
  assert.equal(md('<p>a<br/>b</p><hr/><p>c</p>'), 'a  \nb\n\n---\n\nc\n')
})

test('nested lists use 2 spaces for ul and 3 for ol', () => {
  assert.equal(
    md('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>x<ol><li>y</li></ol></li><li>z</li></ol>'),
    '- a\n  - b\n- c\n\n1. x\n   1. y\n2. z\n',
  )
})

test('blockquote prefixes every line', () => {
  assert.equal(md('<blockquote><p>a</p><p>b</p></blockquote>'), '> a\n>\n> b\n')
})

test('pre becomes a fenced block', () => {
  assert.equal(md('<pre>x &lt; y\n  z</pre>'), '```\nx < y\n  z\n```\n')
})

test('table with th header, pipes escaped and short rows padded', () => {
  assert.equal(
    md('<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>a|b</td></tr></tbody></table>'),
    '| A | B |\n| --- | --- |\n| a\\|b |  |\n',
  )
})

test('table without th uses the first row as header; cell paragraphs use br', () => {
  assert.equal(
    md('<table><tr><td>A</td><td>B</td></tr><tr><td><p>x</p><p>y</p></td><td>z</td></tr></table>'),
    '| A | B |\n| --- | --- |\n| x<br>y | z |\n',
  )
})

test('code macro with language, title and CDATA', () => {
  const s = '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">Java</ac:parameter><ac:parameter ac:name="title">Demo</ac:parameter><ac:plain-text-body><![CDATA[if (a < b && c) {\n  x();\n}]]></ac:plain-text-body></ac:structured-macro>'
  assert.equal(md(s), '**Demo**\n\n```java\nif (a < b && c) {\n  x();\n}\n```\n')
})

test('mermaid and plantuml macros keep their body verbatim', () => {
  const m = '<ac:structured-macro ac:name="mermaid-cloud"><ac:plain-text-body><![CDATA[graph TD\nA-->B]]></ac:plain-text-body></ac:structured-macro>'
  assert.equal(md(m), '```mermaid\ngraph TD\nA-->B\n```\n')
  const p = '<ac:structured-macro ac:name="plantuml"><ac:plain-text-body><![CDATA[@startuml\n@enduml]]></ac:plain-text-body></ac:structured-macro>'
  assert.equal(md(p), '```plantuml\n@startuml\n@enduml\n```\n')
})

test('info and warning macros become alerts', () => {
  const s = '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Read me</p></ac:rich-text-body></ac:structured-macro>'
  assert.equal(md(s), '> [!NOTE]\n>\n> Read me\n')
  const w = '<ac:structured-macro ac:name="warning"><ac:parameter ac:name="title">Careful</ac:parameter><ac:rich-text-body><p>Boom</p></ac:rich-text-body></ac:structured-macro>'
  assert.equal(md(w), '> [!CAUTION]\n> **Careful**\n>\n> Boom\n')
})

test('panel and expand macros', () => {
  const p = '<ac:structured-macro ac:name="panel"><ac:parameter ac:name="title">T</ac:parameter><ac:rich-text-body><p>in</p></ac:rich-text-body></ac:structured-macro>'
  assert.equal(md(p), '> **T**\n>\n> in\n')
  const e = '<ac:structured-macro ac:name="expand"><ac:rich-text-body><p>hidden</p></ac:rich-text-body></ac:structured-macro>'
  assert.equal(md(e), '**Details**\n\nhidden\n')
})

test('page links with and without space key, body and anchor', () => {
  assert.equal(
    md('<p><ac:link><ri:page ri:content-title="My Page"/></ac:link></p>'),
    '[My Page](https://wiki.example.com/display/DOC/My+Page)\n',
  )
  assert.equal(
    md('<p><ac:link ac:anchor="sec"><ri:page ri:content-title="A&amp;B" ri:space-key="OPS"/><ac:link-body>see <b>this</b></ac:link-body></ac:link></p>'),
    '[see **this**](https://wiki.example.com/display/OPS/A%26B#sec)\n',
  )
  assert.equal(
    md('<p><ac:link><ri:page ri:content-title="P"/><ac:plain-text-link-body><![CDATA[Plain]]></ac:plain-text-link-body></ac:link></p>'),
    '[Plain](https://wiki.example.com/display/DOC/P)\n',
  )
})

test('attachment links, user mentions and url links', () => {
  assert.equal(md('<p><ac:link><ri:attachment ri:filename="f.pdf"/></ac:link></p>'), `[f.pdf](${ctx.pageUrl})\n`)
  assert.equal(md('<p>hi <ac:link><ri:user ri:account-id="abc123"/></ac:link></p>'), 'hi @abc123\n')
  assert.equal(md('<p><a href="https://x.example/a?b=1&amp;c=2">go</a></p>'), '[go](https://x.example/a?b=1&c=2)\n')
})

test('images are links, never image syntax', () => {
  assert.equal(md('<p><ac:image><ri:attachment ri:filename="a.png"/></ac:image></p>'), `[Image: a.png](${ctx.pageUrl})\n`)
  assert.equal(md('<p><ac:image><ri:url ri:value="https://x.example/i.png"/></ac:image></p>'), '[Image: https://x.example/i.png](https://x.example/i.png)\n')
})

test('task list', () => {
  const s = '<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Done</ac:task-body></ac:task><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body><span>Todo</span></ac:task-body></ac:task></ac:task-list>'
  assert.equal(md(s), '- [x] Done\n- [ ] Todo\n')
})

test('emoticons, status, jira and time', () => {
  assert.equal(md('<p><ac:emoticon ac:name="tick"/> <ac:emoticon ac:name="nope"/>ok</p>'), '✅ ok\n')
  assert.equal(md('<p><ac:structured-macro ac:name="status"><ac:parameter ac:name="title">done</ac:parameter></ac:structured-macro></p>'), '**[DONE]**\n')
  assert.equal(md('<p>see <ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">PRJ-123</ac:parameter></ac:structured-macro></p>'), 'see `PRJ-123`\n')
  assert.equal(md('<p>on <time datetime="2026-01-02"/></p>'), 'on 2026-01-02\n')
})

test('diagram macros link to the page', () => {
  const s = '<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">Flow</ac:parameter></ac:structured-macro>'
  assert.equal(md(s), `[Diagram: Flow](${ctx.pageUrl})\n`)
})

test('toc is dropped, bodyless macros get a placeholder, unknown macros render their body', () => {
  assert.equal(md('<ac:structured-macro ac:name="toc"/><p>a</p>'), 'a\n')
  assert.equal(md('<ac:structured-macro ac:name="children"/>'), '*[children macro]*\n')
  assert.equal(md('<ac:structured-macro ac:name="whatever"><ac:rich-text-body><p>kept</p></ac:rich-text-body></ac:structured-macro>'), 'kept\n')
})

test('layouts render sections one after another', () => {
  const s = '<ac:layout><ac:layout-section><ac:layout-cell><p>a</p></ac:layout-cell><ac:layout-cell><p>b</p></ac:layout-cell></ac:layout-section></ac:layout>'
  assert.equal(md(s), 'a\n\nb\n')
})

test('entities: named, numeric, unknown', () => {
  assert.equal(md('<p>a&amp;b &lt;c&gt; &#233; &#xE9; &mdash; &nbsp;&eacute; &bogus; &#0;</p>'), 'a&b <c> é é — é &bogus; &#0;\n')
})

test('malformed input never throws', () => {
  const bad = ['<p>unclosed <b>bold', '</div></p>text', '<a href="x', '<<>>', '<!-- open', '<![CDATA[ open', '<ul><li>a<li>b', '<p a=b c d="e>x', '<ac:link><ri:page/></ac:link>']
  for (const s of bad) assert.equal(typeof md(s), 'string')
  assert.equal(md('<p>unclosed <b>bold'), 'unclosed **bold**\n')
  assert.equal(md('</div></p>text'), 'text\n')
})

test('deep nesting and large input stay fast and do not overflow', () => {
  assert.equal(typeof md('<div>'.repeat(50000) + 'x'), 'string')
  const big = '<p>row <b>x</b> &amp; y</p>'.repeat(100000)
  assert.ok(md(big).length > 1000000)
})
