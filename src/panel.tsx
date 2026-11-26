// The Confluence sidebar panel. No build step: Orca strips the types and compiles the JSX.
import {
  atom,
  Button,
  Callout,
  Code,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  List,
  ListItem,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  settings,
  shell,
  Spinner,
  Stack,
  Switch,
  Text,
  type PanelContext
} from 'orca'
import { spaceKeys } from './links'
import type { ConnectionStatus, PageHit } from './protocol'

const status = atom<ConnectionStatus | null>(null)
const query = atom('query', '', { persist: 'plugin' })
const space = atom('space', '', { persist: 'plugin' })
const cql = atom('cql', false, { persist: 'plugin' })
const spaces = atom<string[]>([])
const results = atom<PageHit[] | null>(null)
const total = atom(0)
const recent = atom<PageHit[]>([])
const selected = atom<PageHit | null>(null)
const busy = atom<string | null>(null)
const notice = atom<{ tone: 'success' | 'danger'; text: string; link?: string } | null>(null)
const tokenDraft = atom('')

async function refreshStatus(test = false): Promise<void> {
  set(status, await plugin.request(test ? 'conn.test' : 'conn.status'))
}

async function loadSettings(): Promise<void> {
  set(spaces, spaceKeys(await settings.get('spaces')))
}

async function runSearch(): Promise<void> {
  set(busy, 'Searching')
  set(notice, null)
  try {
    const answer = await plugin.request('search', { query: read(query), space: read(space), cql: read(cql) })
    set(results, answer.results)
    set(total, answer.total)
    if (answer.error) set(notice, { tone: 'danger', text: answer.error })
    if (answer.results.length === 1) set(selected, answer.results[0])
  } finally {
    set(busy, null)
  }
}

async function openPage(hit: PageHit): Promise<void> {
  set(busy, 'Opening')
  try {
    const answer = await plugin.request('page.open', { id: hit.id }, { timeoutMs: 60_000 })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.message })
  } finally {
    set(busy, null)
  }
}

async function copyLink(hit: PageHit): Promise<void> {
  set(busy, 'Copying')
  try {
    const answer = await plugin.request('page.copyLink', { id: hit.id })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.message, link: answer.text })
  } finally {
    set(busy, null)
  }
}

async function saveToken(): Promise<void> {
  set(busy, 'Signing in')
  try {
    set(status, await plugin.request('conn.setToken', { token: read(tokenDraft) }))
    set(tokenDraft, '')
  } finally {
    set(busy, null)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('recent.changed', (payload) => set(recent, payload.results)))
  ctx.subscriptions.push(
    settings.onDidChange(() => {
      void loadSettings()
      void refreshStatus()
    })
  )
  void loadSettings()
  void refreshStatus(true)
  void plugin.request('recent').then((answer) => set(recent, answer.results))
}

function describe(hit: PageHit): string {
  return [hit.spaceKey, hit.version ? `v${hit.version}` : ''].filter(Boolean).join(' · ')
}

function Hits(props: { items: PageHit[]; label: string }) {
  const current = read(selected)
  return (
    <List label={props.label}>
      {props.items.map((hit) => (
        <ListItem
          title={hit.title}
          description={describe(hit)}
          icon="file-text"
          current={current?.id === hit.id}
          onPress={() => set(selected, current?.id === hit.id ? null : hit)}
        />
      ))}
    </List>
  )
}

function Selected(props: { hit: PageHit }) {
  const { hit } = props
  const working = read(busy) !== null
  return (
    <Stack gap="xs">
      <Text weight="semibold">{hit.title}</Text>
      <Text muted size="xs">
        {hit.spaceName || hit.spaceKey}
        {hit.version ? ` · version ${hit.version}` : ''}
        {hit.updatedAt ? ' · updated ' : ''}
        {hit.updatedAt ? <RelativeTime at={hit.updatedAt} muted /> : ''}
      </Text>
      <Row gap="xs" wrap>
        <Button icon="file-text" disabled={working} onPress={() => openPage(hit)}>
          Open in tab
        </Button>
        <Button variant="outline" icon="copy" disabled={working} onPress={() => copyLink(hit)}>
          Copy link
        </Button>
        <IconButton icon="open-external" label="Open in Confluence" tooltip="Open in Confluence" variant="ghost" onPress={() => shell.openExternal(hit.url)} />
      </Row>
    </Stack>
  )
}

function Connection() {
  const s = read(status)
  const working = read(busy) !== null
  return (
    <Collapsible title="Connection" description={s?.user ? `Signed in as ${s.user}` : s?.hasToken ? 'Token saved' : 'Not connected'} defaultOpen={!s?.user}>
      <Stack gap="sm">
        <Text muted size="xs">
          Base URL, sign-in type, e-mail (Cloud), spaces and link style are in Settings → Plugins → Confluence.
          {s?.baseUrl ? ` Now: ${s.baseUrl}` : ''}
        </Text>
        <Input
          label="Token"
          type="password"
          placeholder={s?.hasToken ? 'Saved; paste a new one to replace it' : 'Personal access token (Data Center) or API token (Cloud)'}
          value={read(tokenDraft)}
          onChange={(value) => set(tokenDraft, value)}
          onSubmit={() => saveToken()}
        />
        <Row gap="xs" wrap>
          <Button disabled={working || !read(tokenDraft).trim()} onPress={saveToken}>
            Save and test
          </Button>
          <Button variant="outline" disabled={working || !s?.hasToken} onPress={() => refreshStatus(true)}>
            Test
          </Button>
          <Button variant="ghost" tone="danger" disabled={working || !s?.hasToken} onPress={async () => set(status, await plugin.request('conn.clearToken'))}>
            Forget token
          </Button>
        </Row>
        {s?.error ? <Callout tone="danger">{s.error}</Callout> : null}
      </Stack>
    </Collapsible>
  )
}

export default function Panel() {
  const s = read(status)
  const list = read(results)
  const pick = read(selected)
  const note = read(notice)
  const working = read(busy)
  const spaceOptions = [{ value: '', label: 'All spaces' }, ...read(spaces).map((key) => ({ value: key, label: key }))]
  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Confluence</Heading>
        {working ? <Spinner label={working} labelHidden /> : null}
      </Row>
      <Connection />
      {s?.user ? (
        <Stack gap="sm">
          <Input
            label="Search"
            labelHidden
            type="search"
            placeholder={read(cql) ? 'CQL, e.g. label = architecture' : 'Title or text, a page id or a page URL'}
            value={read(query)}
            onChange={(value) => set(query, value)}
            onSubmit={() => runSearch()}
          />
          <Row gap="sm" wrap>
            <Select label="Space" labelHidden value={read(space)} options={spaceOptions} onChange={(value) => set(space, value)} />
            <Switch label="CQL" checked={read(cql)} onChange={(value) => set(cql, value)} />
            <Button size="sm" disabled={working !== null} onPress={runSearch}>
              Search
            </Button>
          </Row>
        </Stack>
      ) : null}
      {note ? (
        <Callout tone={note.tone}>
          {note.text}
          {note.link ? <Code block>{note.link}</Code> : null}
        </Callout>
      ) : null}
      {pick ? <Selected hit={pick} /> : null}
      {list && list.length ? <Hits items={list} label={read(total) > list.length ? `${list.length} of ${read(total)} results` : `${list.length} results`} /> : null}
      {list && !list.length && !note ? <EmptyState title="No pages found" icon="search" /> : null}
      {read(recent).length ? (
        <Collapsible title="Recently opened" defaultOpen={!list}>
          <Hits items={read(recent)} label="Recently opened" />
        </Collapsible>
      ) : null}
    </Stack>
  )
}
