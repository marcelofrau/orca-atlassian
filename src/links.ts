// Pure helpers: URLs, readable links, CQL, file names. No I/O, so the tests cover them directly.

export type LinkStyle = 'viewpage' | 'webui'

/** The base URL without a trailing slash; '' when it is not an http(s) address. */
export function normaliseBase(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : ''
  return /^https?:\/\/[^\s/]+/i.test(text) ? text : ''
}

/** The page's address: Data Center's stable viewpage URL, or the one Confluence reports (`webui`). */
export function pageUrl(base: string, id: string, style: LinkStyle, webui?: string): string {
  if (style === 'webui' && webui) return /^https?:/i.test(webui) ? webui : base + webui
  return `${base}/pages/viewpage.action?pageId=${encodeURIComponent(id)}`
}

/** `[Exact title](url)`, with the characters that would end the link text escaped. */
export function readableLink(title: string, url: string): string {
  const text = title.replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1')
  return `[${text}](${url.replace(/\)/g, '%29').replace(/ /g, '%20')})`
}

/** A page id typed or pasted: digits, or a URL with `pageId=` or `/pages/<id>`. */
export function pageIdIn(query: string): string | null {
  const text = query.trim()
  if (/^\d{3,}$/.test(text)) return text
  const match = /[?&]pageId=(\d+)/.exec(text) ?? /\/pages\/(\d+)(?:[/?#]|$)/.exec(text)
  return match ? match[1] : null
}

const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** CQL for a search box: free text matches titles and bodies; `cql` passes the query through. */
export function searchCql(query: string, space: string, cql: boolean): string {
  const text = query.trim()
  const inSpace = space ? ` AND space = ${quote(space)}` : ''
  if (cql) return space && !/\bspace\s*(=|in)/i.test(text) ? `(${text})${inSpace}` : text
  if (!text) return `type = page${inSpace} ORDER BY lastmodified DESC`
  return `type = page${inSpace} AND (title ~ ${quote(text)} OR text ~ ${quote(text)})`
}

/** Space keys from the comma- or space-separated setting, upper-cased, without repeats. */
export function spaceKeys(raw: unknown): string[] {
  const keys = typeof raw === 'string' ? raw.split(/[\s,;]+/) : []
  return [...new Set(keys.map((k) => k.trim().toUpperCase()).filter((k) => /^[A-Z0-9~_]+$/i.test(k)))]
}

/** A file name safe on every OS: `<id>-<title-slug>.md`, at most 80 characters before `.md`. */
export function pageFileName(id: string, title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents, split off by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${`${id}-${slug}`.slice(0, 80).replace(/-+$/, '')}.md`
}
