import { assert, test } from 'orca/testing'
import { findPlantUmlJar, localPlantUml, siteImages, splitSvgs, withAssets } from './assets'
import { storageToMarkdown } from './storage-to-markdown'

const ctx = { baseUrl: 'https://wiki.example.com', spaceKey: 'DOC', pageUrl: 'https://wiki.example.com/pages/viewpage.action?pageId=42' }

const page =
  '<p><ac:image><ri:attachment ri:filename="flow.png" /></ac:image></p>' +
  '<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">landscape</ac:parameter></ac:structured-macro>' +
  '<ac:structured-macro ac:name="plantuml"><ac:plain-text-body><![CDATA[A -> B]]></ac:plain-text-body></ac:structured-macro>' +
  '<p><ac:image><ri:attachment ri:filename="missing.png" /></ac:image></p>'

test('embeds fetched images and drawn diagrams, keeps links for the rest', async () => {
  const asked: string[] = []
  const text = await withAssets(
    (assets) => storageToMarkdown(page, { ...ctx, assets }),
    async (ref) => (asked.push(ref), ref === 'missing.png' ? null : `data:image/png;base64,${ref}`),
    async (sources) => sources.map(() => '<svg/>')
  )
  assert.deepEqual(asked.sort(), ['flow.png', 'landscape.png', 'missing.png'])
  assert.match(text, /!\[flow\.png\]\[asset-1\]/)
  assert.match(text, /!\[landscape\]\[asset-2\]\n\n\[Diagram: landscape\]\(/)
  assert.match(text, /!\[PlantUML diagram\]\[asset-3\]\n\n<details><summary>PlantUML source<\/summary>\n\n```plantuml\nA -> B\n```/)
  assert.match(text, /\[Image: missing\.png\]\(https:\/\/wiki\.example\.com/)
  assert.match(text, /\n\[asset-1\]: data:image\/png;base64,flow\.png\n\[asset-2\]: data:image\/png;base64,landscape\.png\n\[asset-3\]: data:image\/svg\+xml;base64,/)
})

test('without fetcher or renderer the page is unchanged', async () => {
  assert.equal(await withAssets((assets) => storageToMarkdown(page, { ...ctx, assets }), null, null), storageToMarkdown(page, ctx))
})

test('site images: only the configured host, only images, attachments by page id', async () => {
  const calls: string[] = []
  const fake = (async (url: URL) => {
    calls.push(String(url))
    const html = String(url).includes('login')
    return new Response(html ? '<html>' : 'PNG', { headers: { 'content-type': html ? 'text/html' : 'image/png' } })
  }) as unknown as typeof fetch
  const get = siteImages(fake, 'https://wiki.example.com', 'Bearer t', '42')
  assert.equal(await get('a b.png'), `data:image/png;base64,${Buffer.from('PNG').toString('base64')}`)
  assert.equal(calls[0], 'https://wiki.example.com/download/attachments/42/a%20b.png')
  assert.equal(await get('https://elsewhere.example.org/x.png'), null)
  assert.equal(await get('https://wiki.example.com/login'), null)
  assert.equal(calls.length, 2)
  assert.equal(await siteImages(fake, 'https://wiki.example.com', 'Bearer t')('x.png'), null)
})

test('PlantUML output splits into one SVG per diagram', () => {
  assert.deepEqual(splitSvgs('<svg>1</svg>\n@@ORCA-ATLASSIAN-NEXT@@\nERROR\n@@ORCA-ATLASSIAN-NEXT@@\n<?xml?><svg>3</svg>', 3), ['<svg>1</svg>', null, '<?xml?><svg>3</svg>'])
})

// Draws for real when this machine has Java and plantuml.jar; passes trivially otherwise.
test('local PlantUML draws each diagram, a broken one as its error picture', async () => {
  const jar = findPlantUmlJar('')
  if (!jar) return
  const svgs = await localPlantUml(jar)(['Alice -> Bob: hi', '@startuml\n[A] --> [B]\n@enduml', 'this is -> broken ->'])
  assert.equal(svgs.length, 3)
  for (const svg of svgs) assert.match(svg ?? '', /^<\?xml|^<svg/)
  assert.match(svgs[0]!, /Alice/)
})

test('plantuml.jar: the setting first, then PLANTUML_JAR', () => {
  const exists = (p: string) => p === '/s.jar' || p === '/e.jar'
  assert.equal(findPlantUmlJar('/s.jar', { PLANTUML_JAR: '/e.jar' }, exists), '/s.jar')
  assert.equal(findPlantUmlJar('', { PLANTUML_JAR: '/e.jar' }, exists), '/e.jar')
  assert.equal(findPlantUmlJar('/nope.jar', {}, exists), null)
})
