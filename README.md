<div align="center">

# Confluence for Orca

**Search Confluence from [Orca](https://github.com/stablyai/orca)'s sidebar, read pages as Markdown tabs, and copy links with their exact titles.**

[![License: GPL v3](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Orca](https://img.shields.io/badge/Orca-%E2%89%A5%201.4.248-6d645b)](https://github.com/stablyai/orca)
[![Confluence](https://img.shields.io/badge/Confluence-Data%20Center%20%7C%20Server%20%7C%20Cloud-0052cc)](https://www.atlassian.com/software/confluence)

</div>

Orca knows Jira, but not Confluence. This plugin adds a **Confluence** panel to Orca's right
sidebar, so the pages you write code and docs against are a search away.

## Features

- **Search** by title or text, by page id, by pasting a page URL, or with raw CQL. Filter by the
  spaces you list in Settings.
- **Open in tab**: the page becomes a read-only Markdown copy in a tab, with headings, lists,
  tables, code blocks, info/tip/note/warning panels (as GitHub alerts), task lists, page links and
  Mermaid/PlantUML macros. draw.io diagrams and images link back to the page. Works great with
  [Markdown Themes](https://github.com/marcelofrau/orca-markdown-themes).
- **Copy link** copies `[Exact page title](url)`, read fresh from Confluence, ready to paste into
  Markdown.
- **Open in Confluence** opens the page in your browser.
- **Recently opened** keeps the last 20 pages you opened.
- Data Center and Server (personal access token) and Cloud (e-mail and API token).

## Install

You need the Orca desktop app 1.4.248 or newer and its `orca` CLI.

```sh
orca plugin install marcelofrau/orca-confluence
```

The plugin runs a small Node worker (it calls your Confluence, writes the page copies and uses
your clipboard), so Orca asks you to approve it. The command prints what it gets and the exact
command to approve it:

```sh
orca plugin install marcelofrau/orca-confluence --approve <fingerprint>
```

## Set up

1. In **Settings → Plugins → Confluence**, set the **Base URL**:
   `https://confluence.example.com` for Data Center or Server,
   `https://your-site.atlassian.net/wiki` for Cloud. For Cloud, also set **Sign-in** to
   *E-mail and API token* and fill in your **Atlassian e-mail**.
2. Optionally list your **Spaces** (`DOC, TEAM`) for the space picker, and pick the **Link style**.
3. Open the **Confluence** panel in the right sidebar, paste a token under **Connection** and press
   **Save and test**. Data Center/Server: a
   [personal access token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html).
   Cloud: an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).

The token is kept in Orca's encrypted plugin secrets and is only sent to your base URL. **Forget
token** deletes it.

## Use

| You want to | Do |
| --- | --- |
| Find a page | Type in the search box and press Enter; pick a space, or switch **CQL** on for a raw query |
| Jump to a page you have a link for | Paste its URL or id and press Enter |
| Read it in Orca | Select it, then **Open in tab** (needs a local workspace in focus) |
| Cite it in a doc | **Copy link**, then paste `[Exact page title](url)` |

Page copies are written to `<workspace>/.orca-confluence/pages/<SPACE>/<id>-<title>.md`. That
folder has its own `.gitignore` (`*`), so copies never reach git. Each copy starts with front
matter (id, version, URL, fetch time) and a note saying it is read-only. Edits are not sent back;
**Open in tab** again to refresh it.

## Limits

- Read-only: nothing is written to Confluence.
- Macros the converter does not know show as *[name macro]* or keep their body; images and
  draw.io diagrams are links to the page, not pictures.
- Links inside a copy point to Confluence, not to other copies.
- Desktop app only, and the page tab needs a local workspace.

## Develop

```sh
git clone https://github.com/marcelofrau/orca-confluence
cd orca-confluence
npm install            # TypeScript and Node types, for the type check only
orca plugin dev load . # prints the approval fingerprint the first time
npm test               # orca plugin test .
npm run check          # orca plugin check .
npm run typecheck
```

| File | What it does |
| --- | --- |
| `src/panel.tsx` | The sidebar panel (Orca components) |
| `src/worker.ts` | The worker: settings, token, requests from the panel |
| `src/confluence.ts` | Confluence REST client (API v1) |
| `src/storage-to-markdown.ts` | Storage format (XHTML and macros) to Markdown, no DOM |
| `src/links.ts` | URLs, readable links, CQL, file names |
| `src/tab-file.ts` | The focused workspace and the `.orca-confluence/` copies |
| `src/clipboard.ts` | The OS clipboard (PowerShell, pbcopy, wl-copy or xclip) |
| `src/protocol.ts` | The panel ↔ worker contract |

## License

[GPL-3.0](LICENSE) © Marcelo Frau. Not affiliated with Atlassian.
