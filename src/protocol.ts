// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

/** One page as the panel lists it. */
export interface PageHit {
  id: string
  title: string
  spaceKey: string
  spaceName: string
  /** Where the page lives in Confluence, as the link style in Settings writes it. */
  url: string
  version: number
  /** When it last changed, ms since the epoch; 0 when Confluence did not say. */
  updatedAt: number
}

export interface ConnectionStatus {
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
    'conn.status': { output: ConnectionStatus }
    /** Signs in with the saved settings and token and answers who you are. */
    'conn.test': { output: ConnectionStatus }
    /** Saves the token in Orca's encrypted secrets, then tests it. */
    'conn.setToken': { input: { token: string }; output: ConnectionStatus }
    'conn.clearToken': { output: ConnectionStatus }
    /** Free text, a page id, a page URL, or CQL when `cql` is set. `space` '' searches all. */
    search: { input: { query: string; space: string; cql: boolean }; output: { results: PageHit[]; total: number; error?: string } }
    /** Pages you opened from the panel, most recent first. */
    recent: { output: { results: PageHit[] } }
    /** Writes a read-only Markdown copy into the focused workspace and opens it in a tab. */
    'page.open': { input: { id: string }; output: Outcome }
    /** Copies `[Exact title](url)` to the clipboard. */
    'page.copyLink': { input: { id: string }; output: Outcome & { text?: string } }
  }
  interface PluginPanelEvents {
    /** Posted after a page is opened, so every panel's recent list stays current. */
    'recent.changed': { results: PageHit[] }
  }
}
