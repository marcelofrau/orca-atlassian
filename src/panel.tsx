// The Atlassian sidebar panel: Confluence and Jira tabs, and a box that opens any copied link.
// No build step: Orca strips the types and compiles the JSX.
import {
  atom,
  Button,
  Callout,
  Code,
  Collapsible,
  EmptyState,
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
  Tab,
  Tabs,
  Text,
  type PanelContext
} from 'orca'
import type { ConnectionStatus, Hit, Product } from './protocol'

const PRODUCTS: Product[] = ['confluence', 'jira']
const NAME: Record<Product, string> = { confluence: 'Confluence', jira: 'Jira' }

const product = atom<Product>('product', 'confluence', { persist: 'plugin' })
const status = atom<Record<Product, ConnectionStatus | null>>({ confluence: null, jira: null })
const scopes = atom<Record<Product, string[]>>({ confluence: [], jira: [] })
const query = atom<Record<Product, string>>('query', { confluence: '', jira: '' }, { persist: 'plugin' })
const scope = atom<Record<Product, string>>('scope', { confluence: '', jira: '' }, { persist: 'plugin' })
const raw = atom<Record<Product, boolean>>('raw', { confluence: false, jira: false }, { persist: 'plugin' })
const results = atom<Record<Product, { items: Hit[]; total: number } | null>>({ confluence: null, jira: null })
const recent = atom<Hit[]>([])
const selected = atom<Hit | null>(null)
const busy = atom<string | null>(null)
const notice = atom<{ tone: 'success' | 'danger'; text: string; link?: string } | null>(null)
const tokenDraft = atom<Record<Product, string>>({ confluence: '', jira: '' })
/** A base URL being typed; null while it shows the saved one. */
const urlDraft = atom<Record<Product, string | null>>({ confluence: null, jira: null })
const linkDraft = atom('')

const patch = <T,>(record: Record<Product, T>, p: Product, value: T) => ({ ...record, [p]: value })

async function work(label: string, job: () => Promise<void>): Promise<void> {
  set(busy, label)
  try {
    await job()
  } finally {
    set(busy, null)
  }
}

async function refresh(p: Product, test = false): Promise<void> {
  const answer = await plugin.request(test ? 'conn.test' : 'conn.status', { product: p })
  set(status, patch(read(status), p, answer))
}

async function loadScopes(): Promise<void> {
  const [c, j] = await Promise.all(PRODUCTS.map((p) => plugin.request('scopes', { product: p })))
  set(scopes, { confluence: c.keys, jira: j.keys })
}

const runSearch = (p: Product) =>
  work('Searching', async () => {
    set(notice, null)
    const answer = await plugin.request('search', { product: p, query: read(query)[p], scope: read(scope)[p], raw: read(raw)[p] })
    set(results, patch(read(results), p, { items: answer.results, total: answer.total }))
    if (answer.error) set(notice, { tone: 'danger', text: answer.error })
    set(selected, answer.results.length === 1 ? answer.results[0] : null)
  })

const openHit = (hit: Hit) =>
  work('Opening', async () => {
    const answer = await plugin.request('open', { product: hit.product, id: hit.id }, { timeoutMs: 60_000 })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.message })
  })

const copyLink = (hit: Hit) =>
  work('Copying', async () => {
    const answer = await plugin.request('copyLink', { product: hit.product, id: hit.id })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.message, link: answer.text })
  })

const openLink = () =>
  work('Opening', async () => {
    const answer = await plugin.request('link.open', { text: read(linkDraft) }, { timeoutMs: 60_000 })
    set(notice, { tone: answer.ok ? 'success' : 'danger', text: answer.message })
    if (answer.ok) set(linkDraft, '')
  })

const saveUrl = (p: Product) =>
  work('Saving', async () => {
    set(status, patch(read(status), p, await plugin.request('conn.configure', { product: p, baseUrl: read(urlDraft)[p] ?? '' })))
    set(urlDraft, patch(read(urlDraft), p, null))
  })

const saveToken = (p: Product) =>
  work('Signing in', async () => {
    set(status, patch(read(status), p, await plugin.request('conn.setToken', { product: p, token: read(tokenDraft)[p] })))
    set(tokenDraft, patch(read(tokenDraft), p, ''))
  })

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('recent.changed', (payload) => set(recent, payload.results)))
  ctx.subscriptions.push(
    settings.onDidChange(() => {
      void loadScopes()
      for (const p of PRODUCTS) void refresh(p)
    })
  )
  void loadScopes()
  for (const p of PRODUCTS) void refresh(p, true)
  void plugin.request('recent').then((answer) => set(recent, answer.results))
}

function Hits(props: { items: Hit[]; label: string }) {
  const current = read(selected)
  const same = (a: Hit | null, b: Hit) => a?.product === b.product && a?.id === b.id
  return (
    <List label={props.label}>
      {props.items.map((hit) => (
        <ListItem
          title={hit.title}
          description={hit.detail}
          icon={hit.product === 'jira' ? 'check' : 'file-text'}
          current={same(current, hit)}
          onPress={() => set(selected, same(current, hit) ? null : hit)}
        />
      ))}
    </List>
  )
}

function Selected(props: { hit: Hit }) {
  const { hit } = props
  const working = read(busy) !== null
  return (
    <Stack gap="xs">
      <Text weight="semibold">{hit.title}</Text>
      <Text muted size="xs">
        {hit.detail}
        {hit.updatedAt ? ' · updated ' : ''}
        {hit.updatedAt ? <RelativeTime at={hit.updatedAt} muted /> : ''}
      </Text>
      <Row gap="xs" wrap>
        <Button icon="file-text" disabled={working} onPress={() => openHit(hit)}>
          Open in tab
        </Button>
        <Button variant="outline" icon="copy" disabled={working} onPress={() => copyLink(hit)}>
          Copy link
        </Button>
        <IconButton icon="open-external" label={`Open in ${NAME[hit.product]}`} tooltip={`Open in ${NAME[hit.product]}`} variant="ghost" onPress={() => shell.openExternal(hit.url)} />
      </Row>
    </Stack>
  )
}

function Connection(props: { p: Product }) {
  const { p } = props
  const s = read(status)[p]
  const working = read(busy) !== null
  const draft = read(tokenDraft)[p]
  return (
    <Collapsible title="Connection" description={s?.user ? `Signed in as ${s.user}` : s?.hasToken ? 'Token saved' : 'Not connected'} defaultOpen={!s?.user}>
      <Stack gap="sm">
        <Row gap="xs" align="end">
          <Input
            label={`${NAME[p]} base URL`}
            placeholder={p === 'jira' ? 'https://jira.example.com' : 'https://confluence.example.com'}
            value={read(urlDraft)[p] ?? s?.baseUrl ?? ''}
            onChange={(value) => set(urlDraft, patch(read(urlDraft), p, value))}
            onSubmit={() => saveUrl(p)}
          />
          <Button size="sm" variant="outline" disabled={working || read(urlDraft)[p] === null} onPress={() => saveUrl(p)}>
            Save
          </Button>
        </Row>
        <Text muted size="xs">
          Cloud sign-in (e-mail and API token) and the {p === 'jira' ? 'project' : 'space'} list are in Settings → Plugins → Atlassian.
        </Text>
        <Input
          label={`${NAME[p]} token`}
          type="password"
          placeholder={s?.hasToken ? 'Saved; paste a new one to replace it' : 'Personal access token (Data Center) or API token (Cloud)'}
          value={draft}
          onChange={(value) => set(tokenDraft, patch(read(tokenDraft), p, value))}
          onSubmit={() => saveToken(p)}
        />
        <Row gap="xs" wrap>
          <Button disabled={working || !draft.trim()} onPress={() => saveToken(p)}>
            Save and test
          </Button>
          <Button variant="outline" disabled={working || !s?.hasToken} onPress={() => work('Testing', () => refresh(p, true))}>
            Test
          </Button>
          <Button
            variant="ghost"
            tone="danger"
            disabled={working || !s?.hasToken}
            onPress={() => work('Forgetting', async () => set(status, patch(read(status), p, await plugin.request('conn.clearToken', { product: p }))))}
          >
            Forget token
          </Button>
        </Row>
        {s?.error ? <Callout tone="danger">{s.error}</Callout> : null}
      </Stack>
    </Collapsible>
  )
}

function Search(props: { p: Product }) {
  const { p } = props
  const isJira = p === 'jira'
  const rawOn = read(raw)[p]
  const options = [{ value: '', label: isJira ? 'All projects' : 'All spaces' }, ...read(scopes)[p].map((key) => ({ value: key, label: key }))]
  const found = read(results)[p]
  return (
    <Stack gap="sm">
      <Connection p={p} />
      {read(status)[p]?.user ? (
        <Stack gap="sm">
          <Input
            label={`Search ${NAME[p]}`}
            labelHidden
            type="search"
            placeholder={
              isJira
                ? rawOn
                  ? 'JQL, e.g. project = DOC AND status = "In Progress"'
                  : 'Text or an issue key; empty lists your open issues'
                : rawOn
                  ? 'CQL, e.g. label = architecture'
                  : 'Title or text, a page id or a page URL'
            }
            value={read(query)[p]}
            onChange={(value) => set(query, patch(read(query), p, value))}
            onSubmit={() => runSearch(p)}
          />
          <Row gap="sm" wrap>
            <Select label={isJira ? 'Project' : 'Space'} labelHidden value={read(scope)[p]} options={options} onChange={(value) => set(scope, patch(read(scope), p, value))} />
            <Switch label={isJira ? 'JQL' : 'CQL'} checked={rawOn} onChange={(value) => set(raw, patch(read(raw), p, value))} />
            <Button size="sm" disabled={read(busy) !== null} onPress={() => runSearch(p)}>
              Search
            </Button>
          </Row>
        </Stack>
      ) : null}
      {found && found.items.length ? (
        <Hits items={found.items} label={found.total > found.items.length ? `${found.items.length} of ${found.total} results` : `${found.items.length} results`} />
      ) : null}
      {found && !found.items.length && !read(notice) ? <EmptyState title="Nothing found" icon="search" /> : null}
    </Stack>
  )
}

export default function Panel() {
  const note = read(notice)
  const pick = read(selected)
  const working = read(busy)
  return (
    <Stack gap="md">
      <Row gap="xs" align="end">
        <Input
          label="Open a link"
          placeholder="Paste a Jira or Confluence link, or an issue key"
          value={read(linkDraft)}
          onChange={(value) => set(linkDraft, value)}
          onSubmit={() => openLink()}
        />
        <Button size="sm" disabled={working !== null || !read(linkDraft).trim()} onPress={openLink}>
          Open
        </Button>
        {working ? <Spinner label={working} labelHidden /> : null}
      </Row>
      <Text muted size="xs">
        Or copy a link anywhere and press Ctrl+Alt+O (Atlassian: Open copied link).
      </Text>
      {note ? (
        <Callout tone={note.tone}>
          {note.text}
          {note.link ? <Code block>{note.link}</Code> : null}
        </Callout>
      ) : null}
      {pick ? <Selected hit={pick} /> : null}
      <Tabs label="Product" value={read(product)} onChange={(value) => set(product, value as Product)}>
        <Tab value="confluence" label="Confluence" icon="book">
          <Search p="confluence" />
        </Tab>
        <Tab value="jira" label="Jira" icon="check">
          <Search p="jira" />
        </Tab>
      </Tabs>
      {read(recent).length ? (
        <Collapsible title="Recently opened" defaultOpen={false}>
          <Hits items={read(recent)} label="Recently opened" />
        </Collapsible>
      ) : null}
    </Stack>
  )
}
