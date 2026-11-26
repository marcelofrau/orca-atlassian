// Pure helpers: find an issue key in pasted text, and build JQL.
const KEY = '[A-Za-z][A-Za-z0-9_]+-\\d+'
const BARE = new RegExp(`^${KEY}$`)
const IN_URL = new RegExp(`(?:/browse/|[?&]selectedIssue=|/issues/|[?&]issueKey=)(${KEY})(?![\\w-])`, 'i')
// Look like keys but are not: a bare "UTF-8", "SHA-256", ...
const NOT_PROJECTS = new Set(['UTF', 'ISO', 'SHA', 'ES'])

function bareKey(text: string): string | null {
  if (!BARE.test(text)) return null
  const key = text.toUpperCase()
  return NOT_PROJECTS.has(key.split('-')[0]) ? null : key
}

export function jiraKeyIn(text: string, jiraBase?: string): string | null {
  const value = text.trim()
  if (!/^https?:\/\//i.test(value)) return bareKey(value)
  if (jiraBase) {
    try {
      if (new URL(value).hostname.toLowerCase() !== new URL(jiraBase).hostname.toLowerCase()) return null
    } catch {
      return null
    }
  }
  return IN_URL.exec(value)?.[1].toUpperCase() ?? null
}

export function jqlFor(query: string, project: string): string {
  const scope = project ? `project = "${project}" AND ` : ''
  const value = query.trim()
  if (!value) return `${scope}assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`
  const key = jiraKeyIn(value)
  if (key) return `key = ${key}`
  return `${scope}text ~ "${value.replace(/[\\"]/g, '\\$&')}" ORDER BY updated DESC`
}

export function jqlPassthrough(query: string, project: string): string {
  const value = query.trim()
  if (!project || !value || /\bproject\s*(=|!=|in\b|not\b)/i.test(value)) return value
  // ORDER BY cannot sit inside the parentheses
  const order = /\border\s+by\b/i.exec(value)
  const where = (order ? value.slice(0, order.index) : value).trim()
  const sort = order ? ` ${value.slice(order.index)}` : ''
  return `project = "${project}"${where ? ` AND (${where})` : ''}${sort}`
}

export function projectKeys(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const keys = raw
    .split(/[\s,;]+/)
    .map((part) => part.toUpperCase())
    .filter((part) => /^[A-Z][A-Z0-9_]+$/.test(part))
  return [...new Set(keys)]
}
