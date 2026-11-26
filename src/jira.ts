// A small Jira REST v2 client (Data Center/Server and Cloud). `fetch` is passed in, so the tests
// run it against a fake server.
export interface JiraConnection {
  baseUrl: string
  auth: 'bearer' | 'basic'
  /** Cloud only: the Atlassian account e-mail that goes with the API token. */
  email: string
  token: string
}

export interface IssueHit {
  key: string
  summary: string
  status: string
  type: string
  assignee: string
  updatedAt: number
  url: string
}

export interface Issue extends IssueHit {
  priority: string
  reporter: string
  resolution: string
  createdAt: number
  due: string
  labels: string[]
  components: string[]
  fixVersions: string[]
  parent?: { key: string; summary: string }
  /** renderedFields.description ('' when none) */
  descriptionHtml: string
  /** fields.description raw (wiki markup or plain text), the fallback */
  descriptionText: string
  subtasks: { key: string; summary: string; status: string }[]
  /** relation is the link type's outward or inward text, depending on which side is present */
  links: { relation: string; key: string; summary: string; status: string }[]
  attachments: { filename: string; size: number; url: string; author: string; createdAt: number }[]
  comments: { author: string; createdAt: number; bodyHtml: string; bodyText: string }[]
  commentTotal: number
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status = 0
  ) {
    super(message)
  }
}

type Fetch = typeof globalThis.fetch
const TIMEOUT_MS = 20_000
const KEY = /^[A-Z][A-Z0-9_]+-\d+$/i

/** Never echoes the token: messages name the status and what to check. */
function failure(status: number, base: string): JiraError {
  if (status === 401) return new JiraError(`Jira at ${base} refused the token (401). Check the token, and for Cloud the e-mail.`, status)
  if (status === 403) return new JiraError('Jira says you may not see this (403).', status)
  if (status === 404) return new JiraError('Jira issue not found or no access (404).', status)
  if (status === 429) return new JiraError('Jira is rate-limiting requests (429). Try again in a minute.', status)
  return new JiraError(`Jira answered ${status}.`, status)
}

export function jiraAuthorization(conn: JiraConnection): string {
  if (conn.auth === 'basic') return `Basic ${Buffer.from(`${conn.email}:${conn.token}`, 'utf8').toString('base64')}`
  return `Bearer ${conn.token}`
}

async function getJson(fetch: Fetch, conn: JiraConnection, path: string): Promise<any> {
  let response: Response
  try {
    response = await fetch(conn.baseUrl + path, {
      headers: { Authorization: jiraAuthorization(conn), Accept: 'application/json' },
      redirect: 'manual', // a redirect here is a login page, not the API
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause?.code ?? (error as Error)?.name ?? 'network error'
    throw new JiraError(`Could not reach ${conn.baseUrl} (${cause}).`)
  }
  if (response.status >= 300 && response.status < 400) {
    throw new JiraError(`${conn.baseUrl} redirected to a login page; check the base URL and the token.`, response.status)
  }
  if (!response.ok) throw failure(response.status, conn.baseUrl)
  try {
    return await response.json()
  } catch {
    throw new JiraError(`${conn.baseUrl} did not answer with JSON; is it the Jira base URL?`)
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value))
const person = (user: any): string => text(user?.displayName ?? user?.name)
const names = (list: unknown): string[] => (Array.isArray(list) ? list.map((item: any) => text(item?.name)).filter(Boolean) : [])

function ms(value: unknown): number {
  const parsed = Date.parse(text(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function hit(conn: JiraConnection, raw: any): IssueHit {
  const key = text(raw?.key)
  return {
    key,
    summary: text(raw?.fields?.summary),
    status: text(raw?.fields?.status?.name),
    type: text(raw?.fields?.issuetype?.name),
    assignee: person(raw?.fields?.assignee),
    updatedAt: ms(raw?.fields?.updated),
    url: `${conn.baseUrl}/browse/${key}`
  }
}

export async function myself(fetch: Fetch, conn: JiraConnection): Promise<string> {
  const user = await getJson(fetch, conn, '/rest/api/2/myself')
  return text(user?.displayName ?? user?.name ?? 'unknown user')
}

export async function searchIssues(fetch: Fetch, conn: JiraConnection, jql: string, limit = 25): Promise<{ results: IssueHit[]; total: number }> {
  const query = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=summary,status,issuetype,assignee,updated`
  const body = await getJson(fetch, conn, query)
  const results = Array.isArray(body?.issues) ? body.issues.map((raw: unknown) => hit(conn, raw)) : []
  return { results, total: Number(body?.total ?? results.length) }
}

const FIELDS =
  'summary,status,issuetype,priority,assignee,reporter,resolution,created,updated,duedate,labels,components,fixVersions,parent,description,subtasks,issuelinks,attachment,comment'

export async function issue(fetch: Fetch, conn: JiraConnection, key: string): Promise<Issue> {
  const id = key.trim().toUpperCase()
  if (!KEY.test(id)) throw new JiraError(`"${key}" is not an issue key.`)
  const body = await getJson(fetch, conn, `/rest/api/2/issue/${id}?expand=renderedFields&fields=${FIELDS}`)
  const fields = body?.fields ?? {}
  const rendered = body?.renderedFields?.comment?.comments
  const rawComments: any[] = Array.isArray(fields.comment?.comments) ? fields.comment.comments : []
  const brief = (raw: any) => ({ key: text(raw?.key), summary: text(raw?.fields?.summary), status: text(raw?.fields?.status?.name) })
  const links = (Array.isArray(fields.issuelinks) ? fields.issuelinks : [])
    .map((link: any) =>
      link?.outwardIssue
        ? { relation: text(link?.type?.outward), ...brief(link.outwardIssue) }
        : link?.inwardIssue
          ? { relation: text(link?.type?.inward), ...brief(link.inwardIssue) }
          : null
    )
    .filter(Boolean)
  return {
    ...hit(conn, { ...body, key: body?.key ?? id }),
    priority: text(fields.priority?.name),
    reporter: person(fields.reporter),
    resolution: text(fields.resolution?.name),
    createdAt: ms(fields.created),
    due: text(fields.duedate),
    labels: Array.isArray(fields.labels) ? fields.labels.map(text).filter(Boolean) : [],
    components: names(fields.components),
    fixVersions: names(fields.fixVersions),
    parent: fields.parent?.key ? { key: text(fields.parent.key), summary: text(fields.parent.fields?.summary) } : undefined,
    descriptionHtml: text(body?.renderedFields?.description),
    descriptionText: text(fields.description),
    subtasks: (Array.isArray(fields.subtasks) ? fields.subtasks : []).map(brief),
    links,
    attachments: (Array.isArray(fields.attachment) ? fields.attachment : []).map((a: any) => ({
      filename: text(a?.filename),
      size: Number(a?.size ?? 0) || 0,
      url: text(a?.content),
      author: person(a?.author),
      createdAt: ms(a?.created)
    })),
    comments: rawComments.map((c, i) => ({
      author: person(c?.author),
      createdAt: ms(c?.created),
      bodyHtml: text(Array.isArray(rendered) ? rendered[i]?.body : ''),
      bodyText: text(c?.body)
    })),
    commentTotal: Number(fields.comment?.total ?? rawComments.length)
  }
}
