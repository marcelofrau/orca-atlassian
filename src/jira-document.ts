// The Markdown shown in the tab for one issue.
import type { Issue } from './jira'

type ToMarkdown = (html: string, pageUrl: string) => string

const day = (ms: number): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '')
const minute = (ms: number): string => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '')
const linkText = (value: string): string => value.replace(/[\\[\]]/g, '\\$&')
const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

function size(bytes: number): string {
  const kb = bytes / 1024
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`
}

export function issueDocument(issue: Issue, ctx: { baseUrl: string }, fetchedAt: Date, htmlToMarkdown: ToMarkdown): string {
  const base = ctx.baseUrl.replace(/\/+$/, '')
  const browse = (key: string) => `${base}/browse/${key}`
  const absolute = (html: string) => html.replace(/\b(href|src)=(["'])\/(?!\/)/gi, `$1=$2${base}/`)
  const convert = (html: string, fallback: string) => (html.trim() ? htmlToMarkdown(absolute(html), issue.url).trim() : fallback.trim())
  const title = `${issue.key}: ${issue.summary}`
  const stamp = fetchedAt.toISOString()

  const rows: [string, string][] = [
    ['Type', issue.type],
    ['Status', issue.status],
    ['Priority', issue.priority],
    ['Resolution', issue.resolution],
    ['Assignee', issue.assignee],
    ['Reporter', issue.reporter],
    ['Created', day(issue.createdAt)],
    ['Updated', day(issue.updatedAt)],
    ['Due', issue.due],
    ['Labels', issue.labels.join(', ')],
    ['Components', issue.components.join(', ')],
    ['Fix versions', issue.fixVersions.join(', ')],
    ['Parent', issue.parent ? `[${linkText(`${issue.parent.key}: ${issue.parent.summary}`)}](${browse(issue.parent.key)})` : '']
  ]
  const brief = (item: { key: string; summary: string; status: string }) => `- [${linkText(item.key)}](${browse(item.key)}) ${item.summary} · ${item.status}`

  const blocks = [
    [
      '---',
      'jira:',
      `  key: ${JSON.stringify(issue.key)}`,
      `  summary: ${JSON.stringify(issue.summary)}`,
      `  status: ${JSON.stringify(issue.status)}`,
      `  url: ${JSON.stringify(issue.url)}`,
      `  updated: "${day(issue.updatedAt)}"`,
      `  fetched: "${stamp}"`,
      '---'
    ].join('\n'),
    `> Read-only copy of [${linkText(title)}](${issue.url}), fetched ${stamp.slice(0, 10)} ${stamp.slice(11, 16)} UTC. Edits here are not sent to Jira; open it again to refresh.`,
    `# ${title}`,
    ['| Field | Value |', '| --- | --- |', ...rows.filter(([, value]) => value).map(([name, value]) => `| ${name} | ${cell(value)} |`)].join('\n'),
    '## Description',
    convert(issue.descriptionHtml, issue.descriptionText) || '*No description.*'
  ]

  if (issue.subtasks.length) blocks.push('## Sub-tasks', issue.subtasks.map(brief).join('\n'))
  if (issue.links.length) {
    blocks.push('## Linked issues')
    const groups = new Map<string, Issue['links']>()
    for (const link of issue.links) groups.set(link.relation, [...(groups.get(link.relation) ?? []), link])
    for (const [relation, items] of groups) blocks.push(`**${relation}**:`, items.map(brief).join('\n'))
  }
  if (issue.attachments.length) {
    blocks.push('## Attachments', issue.attachments.map((a) => `- [${linkText(a.filename)}](${a.url}) · ${size(a.size)} · ${a.author} · ${day(a.createdAt)}`).join('\n'))
  }
  if (issue.comments.length) {
    blocks.push(`## Comments (${issue.commentTotal})`)
    for (const c of issue.comments) blocks.push(`### ${c.author} · ${minute(c.createdAt)}`, convert(c.bodyHtml, c.bodyText))
    if (issue.commentTotal > issue.comments.length) blocks.push(`*Showing ${issue.comments.length} of ${issue.commentTotal} comments; the rest are in Jira.*`)
  }
  return blocks.join('\n\n') + '\n'
}
