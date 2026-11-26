// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

export type Product = 'confluence' | 'jira'

/** One search result, a Confluence page or a Jira issue, as the panel lists it. */
export interface Hit {
  product: Product
  /** Page id or issue key. */
  id: string
  title: string
  /** Space name and version, or issue type, status and assignee. */
  detail: string
  url: string
  /** When it last changed, ms since the epoch; 0 when unknown. */
  updatedAt: number
}

export interface ConnectionStatus {
  product: Product
  /** A base URL is set (and, for Cloud, an e-mail). */
  configured: boolean
  hasToken: boolean
  baseUrl: string
  /** The signed-in user's display name, after a successful test. */
  user?: string
  error?: string
}

export type Outcome = { ok: true; message: string } | { ok: false; message: string }

declare module 'orca' {
  interface PluginRequests {
    /** What is configured; no network call. */
    'conn.status': { input: { product: Product }; output: ConnectionStatus }
    /** Signs in with the saved settings and token and answers who you are. */
    'conn.test': { input: { product: Product }; output: ConnectionStatus }
    /** Saves the token in Orca's encrypted secrets, then tests it. */
    'conn.setToken': { input: { product: Product; token: string }; output: ConnectionStatus }
    'conn.clearToken': { input: { product: Product }; output: ConnectionStatus }
    /** Saves the base URL (and, when given, the space or project keys) in Settings, then tests the connection. */
    'conn.configure': { input: { product: Product; baseUrl: string; scopes?: string }; output: ConnectionStatus }
    /** Confluence: text, page id, page URL or CQL. Jira: text, key, issue URL or JQL. `scope` is a space or project key, '' for all. */
    search: { input: { product: Product; query: string; scope: string; raw: boolean }; output: { results: Hit[]; total: number; error?: string } }
    /** Space keys (Confluence) or project keys (Jira) from Settings, for the scope picker. */
    scopes: { input: { product: Product }; output: { keys: string[] } }
    /** What you opened from the panel or a link, most recent first, both products. */
    recent: { output: { results: Hit[] } }
    /** Writes a read-only Markdown copy into the focused workspace and opens it in a tab. */
    open: { input: { product: Product; id: string }; output: Outcome }
    /** Opens whatever Jira or Confluence link or issue key is in `text`. */
    'link.open': { input: { text: string }; output: Outcome }
    /** Copies `[Exact title](url)` (or `[KEY: Summary](url)`) to the clipboard. */
    copyLink: { input: { product: Product; id: string }; output: Outcome & { text?: string } }
  }
  interface PluginPanelEvents {
    /** Posted after something is opened, so every panel's recent list stays current. */
    'recent.changed': { results: Hit[] }
  }
}
