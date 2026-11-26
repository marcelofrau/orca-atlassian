// Confluence storage format (XHTML) to GitHub-flavoured Markdown. No DOM, no dependencies, never throws.

export type Ctx = { baseUrl: string; spaceKey: string; pageUrl: string; assets?: Assets }

/**
 * Embeds images and diagrams. Each call names one: an attachment file name of this page (draw.io and
 * Gliffy previews are `<name>.png`), an image URL, or a PlantUML source. It answers the reference
 * label to embed it with (`![alt][label]`, defined by the caller), or nothing to keep a plain link.
 */
export interface Assets {
  image(ref: string): string | undefined
  plantuml(source: string): string | undefined
}

const embedded = (alt: string, label: string) => `![${alt.replace(/[[\]\\]/g, '')}][${label}]`

type El = { tag: string; attrs: Record<string, string>; kids: Node[] }
type Node = string | El

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
  hellip: '…', copy: '©', reg: '®', trade: '™', euro: '€', laquo: '«',
  raquo: '»', middot: '·', bull: '•', times: '×', deg: '°', eacute: 'é',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ccedil: 'ç',
  atilde: 'ã', otilde: 'õ', agrave: 'à',
}

const EMOTICONS: Record<string, string> = {
  tick: '✅', cross: '❌', warning: '⚠️', information: 'ℹ️', plus: '➕', minus: '➖',
  question: '❓', smile: '🙂', sad: '🙁', 'light-on': '💡', star_yellow: '⭐',
}

const ALERTS: Record<string, string> = { info: 'NOTE', tip: 'TIP', note: 'WARNING', warning: 'CAUTION' }
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr'])
const MAX_DEPTH = 200
const INLINE_TAGS = new Set([
  'strong', 'b', 'em', 'i', 's', 'del', 'strike', 'u', 'span', 'sup', 'sub', 'small', 'font', 'code', 'a',
  'time', 'br', 'img', 'big', 'mark', 'abbr', 'cite', 'q', 'kbd', 'var', 'tt', 'ins', 'wbr',
  'ac:link', 'ac:image', 'ac:emoticon', 'ac:placeholder', 'ac:parameter', 'ac:plain-text-body',
  'ac:inline-comment-marker', 'script', 'style', 'head',
])
const INLINE_MACROS = new Set(['status', 'jira', 'anchor', 'span'])
const DIAGRAMS = new Set(['drawio', 'drawio-sketch', 'inc-drawio', 'gliffy'])
const PLAIN_FENCES: Record<string, string> = { mermaid: 'mermaid', 'mermaid-macro': 'mermaid', 'mermaid-cloud': 'mermaid', plantuml: 'plantuml' }

// ---------- tokenizer / tree builder ----------

function decode(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e] ?? m
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
  })
}

const OPEN = /<([A-Za-z][\w:.-]*)/y
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y

function parse(s: string): El {
  const root: El = { tag: '#root', attrs: Object.create(null), kids: [] }
  const stack: El[] = [root]
  const n = s.length
  let i = 0
  while (i < n) {
    const lt = s.indexOf('<', i)
    if (lt < 0) { stack[stack.length - 1].kids.push(decode(s.slice(i))); break }
    if (lt > i) stack[stack.length - 1].kids.push(decode(s.slice(i, lt)))
    i = lt
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      i = end < 0 ? n : end + 3
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9)
      stack[stack.length - 1].kids.push(s.slice(i + 9, end < 0 ? n : end))
      i = end < 0 ? n : end + 3
    } else if (s[i + 1] === '!' || s[i + 1] === '?') {
      const gt = s.indexOf('>', i)
      i = gt < 0 ? n : gt + 1
    } else if (s[i + 1] === '/') {
      const gt = s.indexOf('>', i)
      const name = s.slice(i + 2, gt < 0 ? n : gt).trim().toLowerCase()
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break }
      i = gt < 0 ? n : gt + 1
    } else {
      OPEN.lastIndex = i
      const m = OPEN.exec(s)
      if (!m) { stack[stack.length - 1].kids.push('<'); i++; continue }
      const el: El = { tag: m[1].toLowerCase(), attrs: Object.create(null), kids: [] }
      i += m[0].length
      let selfClose = false
      while (i < n) {
        while (i < n && /\s/.test(s[i])) i++
        if (s[i] === '>') { i++; break }
        if (s[i] === '/' && s[i + 1] === '>') { selfClose = true; i += 2; break }
        ATTR.lastIndex = i
        const a = ATTR.exec(s)
        if (!a) { i++; continue }
        el.attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '')
        i += a[0].length
      }
      const leaf = selfClose || VOID.has(el.tag)
      if (stack.length > MAX_DEPTH && !leaf) continue // too deep: drop the tag, keep its children
      stack[stack.length - 1].kids.push(el)
      if (!leaf) stack.push(el)
    }
  }
  return root
}

// ---------- helpers ----------

const isEl = (n: Node): n is El => typeof n !== 'string'

function child(n: El, tag: string): El | undefined {
  for (const k of n.kids) if (isEl(k) && k.tag === tag) return k
  return undefined
}

function textOf(n: Node): string {
  if (typeof n === 'string') return n
  if (n.tag === 'br') return '\n'
  let out = ''
  for (const k of n.kids) out += textOf(k)
  return out
}

function longestRun(s: string): number {
  let max = 0
  for (const m of s.matchAll(/`+/g)) if (m[0].length > max) max = m[0].length
  return max
}

function fence(text: string, lang = ''): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
  const f = '`'.repeat(Math.max(3, longestRun(body) + 1))
  return `${f}${lang}\n${body}\n${f}`
}

function inlineCode(text: string): string {
  const t = text.replace(/\s*\n\s*/g, ' ')
  if (!t.trim()) return ''
  const f = '`'.repeat(longestRun(t) + 1)
  const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : ''
  return `${f}${pad}${t}${pad}${f}`
}

const mdUrl = (u: string) => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
const link = (text: string, url: string) => `[${text || url}](${mdUrl(url)})`

function wrap(s: string, mark: string): string {
  const core = s.trim()
  if (!core) return s ? ' ' : ''
  const lead = s.slice(0, s.length - s.trimStart().length)
  const trail = s.slice(s.trimEnd().length)
  return `${lead}${mark}${core}${mark}${trail}`
}

// Hard breaks stay as two spaces + newline; any other whitespace around newlines is normalised.
function tidy(s: string): string {
  return s.replace(/[ \t]*(?:\n[ \t]*)+/g, (m) => (m.split('\n').length === 2 ? '  \n' : '\n\n')).replace(/ {2,}(?=\S)/g, ' ').trim()
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

function quote(text: string): string {
  return text.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')
}

function params(n: El): Record<string, string> {
  const p: Record<string, string> = Object.create(null)
  for (const k of n.kids) if (isEl(k) && k.tag === 'ac:parameter') p[(k.attrs['ac:name'] ?? '').toLowerCase()] = textOf(k).trim()
  return p
}

const macroName = (n: El) => (n.attrs['ac:name'] ?? '').toLowerCase()
const isMacro = (n: El) => n.tag === 'ac:structured-macro' || n.tag === 'ac:macro'

function isInline(n: Node): boolean {
  if (typeof n === 'string') return true
  if (isMacro(n)) return INLINE_MACROS.has(macroName(n))
  return INLINE_TAGS.has(n.tag) || n.tag.startsWith('ri:')
}

// ---------- inline ----------

function inline(nodes: Node[], ctx: Ctx): string {
  let out = ''
  for (const n of nodes) out += typeof n === 'string' ? n.replace(/\s+/g, ' ') : inlineEl(n, ctx)
  return out
}

function inlineEl(n: El, ctx: Ctx): string {
  switch (n.tag) {
    case 'strong': case 'b': return wrap(inline(n.kids, ctx), '**')
    case 'em': case 'i': return wrap(inline(n.kids, ctx), '*')
    case 's': case 'del': case 'strike': return wrap(inline(n.kids, ctx), '~~')
    case 'code': return inlineCode(textOf(n))
    case 'br': return '  \n'
    case 'a': {
      const text = oneLine(inline(n.kids, ctx))
      return n.attrs.href ? link(text, n.attrs.href) : text
    }
    case 'time': return n.attrs.datetime || inline(n.kids, ctx)
    // Images stand apart: two in a row would otherwise read as one glued link.
    case 'img': {
      const src = n.attrs.src
      if (!src) return ''
      const label = ctx.assets?.image(src)
      return ` ${label ? embedded(n.attrs.alt || src.split('/').pop() || 'image', label) : link(`Image: ${src}`, src)} `
    }
    case 'ac:link': return confLink(n, ctx)
    case 'ac:image': {
      const image = confImage(n, ctx)
      return image ? ` ${image} ` : ''
    }
    case 'ac:emoticon': return EMOTICONS[n.attrs['ac:name'] ?? ''] ?? ''
    case 'ac:placeholder': case 'ac:parameter': case 'ac:plain-text-body': case 'script': case 'style': case 'head': return ''
    case 'ac:structured-macro': case 'ac:macro': return macro(n, ctx).join(' ')
  }
  if (n.tag.startsWith('ri:')) return ''
  if (INLINE_TAGS.has(n.tag)) return inline(n.kids, ctx)
  return blocks([n], ctx).join('\n') // a block element met in an inline context
}

function confLink(n: El, ctx: Ctx): string {
  const rich = child(n, 'ac:link-body')
  const plain = child(n, 'ac:plain-text-link-body')
  const body = oneLine(rich ? inline(rich.kids, ctx) : plain ? textOf(plain) : '')
  const anchor = n.attrs['ac:anchor']
  const page = child(n, 'ri:page')
  const att = child(n, 'ri:attachment')
  const user = child(n, 'ri:user')
  const url = child(n, 'ri:url')
  if (user) {
    const id = user.attrs['ri:username'] || user.attrs['ri:userkey'] || user.attrs['ri:account-id'] || ''
    return id ? `@${id}` : body
  }
  if (page) {
    const title = page.attrs['ri:content-title'] ?? ''
    const space = page.attrs['ri:space-key'] || ctx.spaceKey
    const href = `${ctx.baseUrl}/display/${space}/${encodeURIComponent(title).replace(/%20/g, '+')}${anchor ? `#${anchor}` : ''}`
    return link(body || title, href)
  }
  if (att) return link(body || att.attrs['ri:filename'] || '', ctx.pageUrl)
  if (url) return url.attrs['ri:value'] ? link(body, url.attrs['ri:value']) : body
  return anchor && body ? link(body, `#${anchor}`) : body
}

function confImage(n: El, ctx: Ctx): string {
  const att = child(n, 'ri:attachment')
  if (att) {
    const name = att.attrs['ri:filename'] ?? ''
    // An attachment of another page (a ri:page inside) is not fetched; it stays a link.
    const label = name && !child(att, 'ri:page') ? ctx.assets?.image(name) : undefined
    return label ? embedded(name, label) : link(`Image: ${name}`, ctx.pageUrl)
  }
  const url = child(n, 'ri:url')?.attrs['ri:value']
  if (!url) return ''
  const label = ctx.assets?.image(url)
  return label ? embedded(url.split('/').pop() || 'image', label) : link(`Image: ${url}`, url)
}

// ---------- blocks ----------

function blocks(nodes: Node[], ctx: Ctx): string[] {
  const out: string[] = []
  let run: Node[] = []
  const flush = () => {
    if (!run.length) return
    const p = tidy(inline(run, ctx))
    if (p) out.push(p)
    run = []
  }
  for (const n of nodes) {
    if (isInline(n)) run.push(n)
    else { flush(); for (const b of block(n as El, ctx)) out.push(b) }
  }
  flush()
  return out
}

function block(n: El, ctx: Ctx): string[] {
  switch (n.tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const t = oneLine(inline(n.kids, ctx))
      return t ? [`${'#'.repeat(Number(n.tag[1]))} ${t}`] : []
    }
    case 'hr': return ['---']
    case 'ul': case 'ol': return list(n, ctx)
    case 'blockquote': {
      const b = blocks(n.kids, ctx)
      return b.length ? [quote(b.join('\n\n'))] : []
    }
    case 'pre': return [fence(textOf(n))]
    case 'table': return table(n, ctx)
    case 'ac:task-list': return tasks(n, ctx)
    case 'ac:structured-macro': case 'ac:macro': return macro(n, ctx)
    default: return blocks(n.kids, ctx)
  }
}

const LIST_START = /^(?:[-*] |\d+\. )/

function list(n: El, ctx: Ctx): string[] {
  const items: string[] = []
  for (const li of n.kids) {
    if (!isEl(li) || li.tag !== 'li') continue
    const parts = blocks(li.kids, ctx)
    if (!parts.length) continue
    const marker = n.tag === 'ol' ? `${items.length + 1}. ` : '- '
    let body = parts[0]
    for (let k = 1; k < parts.length; k++) body += (LIST_START.test(parts[k]) ? '\n' : '\n\n') + parts[k]
    const pad = ' '.repeat(marker.length)
    items.push(marker + body.split('\n').map((l, j) => (j && l ? pad + l : l)).join('\n'))
  }
  return items.length ? [items.join('\n')] : []
}

function tasks(n: El, ctx: Ctx): string[] {
  const lines: string[] = []
  for (const t of n.kids) {
    if (!isEl(t) || t.tag !== 'ac:task') continue
    const done = textOf(child(t, 'ac:task-status') ?? '').trim() === 'complete'
    const body = child(t, 'ac:task-body')
    lines.push(`- [${done ? 'x' : ' '}] ${oneLine(body ? blocks(body.kids, ctx).join(' ') : '')}`.trimEnd())
  }
  return lines.length ? [lines.join('\n')] : []
}

function collectRows(n: El, out: El[]): El[] {
  for (const k of n.kids) {
    if (!isEl(k)) continue
    if (k.tag === 'tr') out.push(k)
    else if (k.tag === 'thead' || k.tag === 'tbody' || k.tag === 'tfoot') collectRows(k, out)
  }
  return out
}

function table(n: El, ctx: Ctx): string[] {
  const rows = collectRows(n, [])
    .map((tr) =>
      tr.kids
        .filter((c): c is El => isEl(c) && (c.tag === 'td' || c.tag === 'th'))
        .map((c) => blocks(c.kids, ctx).join('\n').replace(/\s*\n\s*/g, '<br>').replace(/\|/g, '\\|')),
    )
    .filter((r) => r.length)
  if (!rows.length) return []
  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  const line = (r: string[]) => {
    const cells = r.slice()
    while (cells.length < width) cells.push('')
    return `| ${cells.join(' | ')} |`
  }
  const sep = `| ${Array(width).fill('---').join(' | ')} |`
  return [[line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n')]
}

// ---------- macros ----------

function macro(n: El, ctx: Ctx): string[] {
  const name = macroName(n)
  const p = params(n)
  const rich = child(n, 'ac:rich-text-body')
  const plain = child(n, 'ac:plain-text-body')
  const raw = plain ? textOf(plain) : rich ? textOf(rich) : ''
  const body = () => (rich ? blocks(rich.kids, ctx) : [])
  const title = p.title ? `**${p.title}**` : ''
  switch (name) {
    case 'code': case 'noformat': {
      const lang = (p.language ?? '').toLowerCase()
      return [...(title ? [title] : []), fence(raw, lang === 'none' ? '' : lang)]
    }
    case 'info': case 'tip': case 'note': case 'warning': {
      const head = [`[!${ALERTS[name]}]`, ...(title ? [title] : [])].join('\n')
      return [quote([head, ...body()].join('\n\n'))]
    }
    case 'panel': {
      const parts = [...(title ? [title] : []), ...body()]
      return parts.length ? [quote(parts.join('\n\n'))] : []
    }
    case 'expand': return [`**${p.title || 'Details'}**`, ...body()]
    case 'jira':
      if (p.key) return [inlineCode(p.key)]
      return p.jqlquery ? [inlineCode(`Jira: ${p.jqlquery}`)] : []
    case 'status': return p.title ? [`**[${p.title.toUpperCase()}]**`] : []
    case 'toc': case 'anchor': return []
  }
  if (name === 'plantuml') {
    const label = raw.trim() ? ctx.assets?.plantuml(raw) : undefined
    if (label) return [embedded('PlantUML diagram', label), `<details><summary>PlantUML source</summary>\n\n${fence(raw, 'plantuml')}\n\n</details>`]
  }
  if (PLAIN_FENCES[name]) return [fence(raw, PLAIN_FENCES[name])]
  if (DIAGRAMS.has(name)) {
    const diagram = p.diagramname || p.name || ''
    const back = link(`Diagram: ${diagram || name}`, ctx.pageUrl)
    // inc-drawio shows a diagram of another page; only this page's previews are fetched.
    const label = diagram && name !== 'inc-drawio' ? ctx.assets?.image(`${diagram}.png`) : undefined
    return label ? [embedded(diagram, label), back] : [back]
  }
  if (rich) return body() // excerpt, section, column, details, div, span, layout and unknown macros
  return [`*[${name} macro]*`]
}

export function storageToMarkdown(storage: string, ctx: Ctx): string {
  try {
    const out = blocks(parse(String(storage ?? '')).kids, ctx).join('\n\n')
    return out ? `${out}\n` : ''
  } catch {
    return ''
  }
}
