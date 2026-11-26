// Works out what a pasted or copied text points at: a Jira issue or a Confluence page.
import { jiraKeyIn } from './jira-links'
import { pageIdIn } from './links'

export type Target =
  | { product: 'jira'; id: string }
  | { product: 'confluence'; id: string }
  /** A `/display/SPACE/Title` link: the worker looks the page up by title. */
  | { product: 'confluence'; space: string; title: string }

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/i

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function confluenceTarget(url: string): Target | null {
  const id = pageIdIn(url)
  if (id) return { product: 'confluence', id }
  const display = /\/display\/([^/?#]+)\/([^?#]+)/.exec(url)
  if (!display) return null
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part.replace(/\+/g, ' '))
    } catch {
      return part.replace(/\+/g, ' ')
    }
  }
  return { product: 'confluence', space: decode(display[1]), title: decode(display[2]) }
}

/** The target in `text`, or null. URLs count only on the configured hosts; a bare issue key or page id always counts. */
export function detectLink(text: string, bases: { confluence: string; jira: string }): Target | null {
  const trimmed = text.trim()
  const url = URL_IN_TEXT.exec(trimmed)?.[0]
  if (url) {
    const host = hostOf(url)
    if (bases.jira && host === hostOf(bases.jira)) {
      const key = jiraKeyIn(url, bases.jira)
      if (key) return { product: 'jira', id: key }
    }
    if (bases.confluence && host === hostOf(bases.confluence)) return confluenceTarget(url)
    return null
  }
  const key = jiraKeyIn(trimmed)
  if (key) return { product: 'jira', id: key }
  if (/^\d{5,}$/.test(trimmed)) return { product: 'confluence', id: trimmed }
  return null
}
