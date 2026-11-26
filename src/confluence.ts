// A small Confluence REST client (Data Center/Server and Cloud, API v1). `fetch` is passed in, so
// the tests run it against a fake server.
import { pageUrl, type LinkStyle } from './links'
import type { PageHit } from './protocol'

export interface Connection {
  baseUrl: string
  auth: 'bearer' | 'basic'
  /** Cloud only: the Atlassian account e-mail that goes with the API token. */
  email: string
  token: string
  linkStyle: LinkStyle
}

export interface Page extends PageHit {
  storage: string
  ancestors: { id: string; title: string }[]
}

export class ConfluenceError extends Error {
  constructor(
    message: string,
    readonly status = 0
  ) {
    super(message)
  }
}

type Fetch = typeof globalThis.fetch
const TIMEOUT_MS = 20_000

/** Never echoes the token: messages name the status and what to check. */
function failure(status: number, base: string): ConfluenceError {
  if (status === 401) return new ConfluenceError(`Confluence at ${base} refused the token (401). Check the token, and for Cloud the e-mail.`, status)
  if (status === 403) return new ConfluenceError('Confluence says you may not see this (403).', status)
  if (status === 404) return new ConfluenceError('Confluence could not find it (404).', status)
  if (status === 429) return new ConfluenceError('Confluence is rate-limiting requests (429). Try again in a minute.', status)
  return new ConfluenceError(`Confluence answered ${status}.`, status)
}

export function authorization(conn: Connection): string {
  if (conn.auth === 'basic') return `Basic ${Buffer.from(`${conn.email}:${conn.token}`, 'utf8').toString('base64')}`
  return `Bearer ${conn.token}`
}

async function getJson(fetch: Fetch, conn: Connection, path: string): Promise<any> {
  let response: Response
  try {
    response = await fetch(conn.baseUrl + path, {
      headers: { Authorization: authorization(conn), Accept: 'application/json' },
      redirect: 'manual', // a redirect here is a login page, not the API
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause?.code ?? (error as Error)?.name ?? 'network error'
    throw new ConfluenceError(`Could not reach ${conn.baseUrl} (${cause}).`)
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ConfluenceError(`${conn.baseUrl} redirected to a login page; check the base URL and the token.`, response.status)
  }
  if (!response.ok) throw failure(response.status, conn.baseUrl)
  try {
    return await response.json()
  } catch {
    throw new ConfluenceError(`${conn.baseUrl} did not answer with JSON; is it the Confluence base URL?`)
  }
}

function hit(conn: Connection, raw: any, linksBase?: string): PageHit {
  const when = Date.parse(raw?.version?.when ?? raw?.history?.lastUpdated?.when ?? '')
  const base = typeof linksBase === 'string' ? linksBase.replace(/\/+$/, '') : conn.baseUrl
  return {
    id: String(raw?.id ?? ''),
    title: String(raw?.title ?? ''),
    spaceKey: String(raw?.space?.key ?? ''),
    spaceName: String(raw?.space?.name ?? ''),
    url: pageUrl(conn.baseUrl, String(raw?.id ?? ''), conn.linkStyle, raw?._links?.webui ? base + raw._links.webui : undefined),
    version: Number(raw?.version?.number ?? 0),
    updatedAt: Number.isFinite(when) ? when : 0
  }
}

export async function currentUser(fetch: Fetch, conn: Connection): Promise<string> {
  const user = await getJson(fetch, conn, '/rest/api/user/current')
  if (user?.type === 'anonymous') throw new ConfluenceError('Confluence treated the token as anonymous; check it.', 401)
  return String(user?.displayName ?? user?.publicName ?? user?.username ?? 'unknown user')
}

export async function search(fetch: Fetch, conn: Connection, cql: string, limit = 25): Promise<{ results: PageHit[]; total: number }> {
  const query = `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=space,version`
  const body = await getJson(fetch, conn, query)
  const results = Array.isArray(body?.results) ? body.results.map((r: unknown) => hit(conn, r, body?._links?.base)) : []
  return { results, total: Number(body?.totalSize ?? body?.size ?? results.length) }
}

export async function page(fetch: Fetch, conn: Connection, id: string): Promise<Page> {
  if (!/^\d+$/.test(id)) throw new ConfluenceError(`"${id}" is not a page id.`)
  const body = await getJson(fetch, conn, `/rest/api/content/${id}?expand=body.storage,space,version,ancestors`)
  return {
    ...hit(conn, body, body?._links?.base),
    storage: String(body?.body?.storage?.value ?? ''),
    ancestors: Array.isArray(body?.ancestors) ? body.ancestors.map((a: any) => ({ id: String(a?.id ?? ''), title: String(a?.title ?? '') })) : []
  }
}
