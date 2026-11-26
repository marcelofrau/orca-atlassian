<div align="center">

# Atlassian for Orca

**Read Jira issues and Confluence pages inside [Orca](https://github.com/stablyai/orca), without the browser sign-in: search from the sidebar, open them as Markdown tabs, open any copied link with one shortcut.**

[![Release](https://img.shields.io/github/v/release/marcelofrau/orca-atlassian?sort=semver&color=0052cc)](https://github.com/marcelofrau/orca-atlassian/releases)
[![License: GPL v3](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Orca](https://img.shields.io/badge/Orca-%E2%89%A5%201.4.248-6d645b)](https://github.com/stablyai/orca)
[![Jira](https://img.shields.io/badge/Jira-Data%20Center%20%7C%20Server%20%7C%20Cloud-0052cc)](https://www.atlassian.com/software/jira)
[![Confluence](https://img.shields.io/badge/Confluence-Data%20Center%20%7C%20Server%20%7C%20Cloud-0052cc)](https://www.atlassian.com/software/confluence)

</div>

When your company's single sign-on keeps Jira and Confluence out of Orca's built-in browser, this
plugin reads them with your API tokens instead and shows them as Markdown tabs, right next to
your code and agents.

## Features

- **Open copied link**: copy any Jira or Confluence link (Orca's link menu and
  [Markdown Themes](https://github.com/marcelofrau/orca-markdown-themes)' have **Copy link**), then
  click **Open link** in the status bar, press `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS), or press
  **Open copied link** in the panel, and it opens in a tab. Also takes a
  bare issue key such as `DOC-12`, a page id, or an old `/display/SPACE/Title` link.
- **Jira**: search by text, issue key, issue URL or raw JQL, filtered by the projects in Settings;
  an empty search lists your open issues. An issue opens with its fields, description, sub-tasks,
  linked issues, attachments (as links) and comments.
- **Confluence**: search by title or text, page id, page URL or raw CQL, filtered by the spaces in
  Settings. A page opens with headings, lists, tables, code, info/tip/note/warning panels (as
  GitHub alerts), task lists, page links and Mermaid/PlantUML macros; draw.io diagrams and images
  link back to the page.
- **Copy link** copies `[Exact page title](url)` or `[DOC-12: Summary](url)`, read fresh.
- **Open in Jira / Confluence** in your browser, and **Recently opened** for both.
- Data Center and Server (personal access tokens) and Cloud (e-mail and API token). Tokens stay
  in Orca's encrypted plugin secrets and go only to the base URLs you set.

Copies are read-only Markdown files, so they look great with
[Markdown Themes](https://github.com/marcelofrau/orca-markdown-themes).

## Install

You need the Orca desktop app 1.4.248 or newer and its `orca` CLI.

```sh
orca plugin install marcelofrau/orca-atlassian
```

The plugin runs a small Node worker (it calls Jira and Confluence, writes the copies and uses
your clipboard), so Orca asks you to approve it. The command prints what it gets and the exact
command to approve it:

```sh
orca plugin install marcelofrau/orca-atlassian --approve <fingerprint>
```

## Set up

1. In **Settings → Plugins → Atlassian**, set the **Jira base URL** and/or the **Confluence base
   URL**:
   - Data Center or Server: `https://jira.example.com`, `https://confluence.example.com`
   - Cloud: `https://your-site.atlassian.net` and `https://your-site.atlassian.net/wiki`, with
     **sign-in** set to *E-mail and API token* and your **e-mail** filled in.
2. Optionally list your **Jira projects** and **Confluence spaces** for the pickers.
3. Open the **Atlassian** panel in the right sidebar. On the **Jira** and **Confluence** tabs, paste
   a token under **Connection** and press **Save and test**:
   [personal access token](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html)
   for Data Center/Server, [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
   for Cloud.

## Use

| You want to | Do |
| --- | --- |
| Read a link you see in a terminal, chat or doc | **Copy link** on it, then **Open link** in the status bar (or `Ctrl+Shift+L`) |
| Read a link or key you have | Paste it in **Open a link** at the top of the panel |
| Find an issue or page | Search on the **Jira** or **Confluence** tab; switch **JQL**/**CQL** on for raw queries |
| See your open issues | Search Jira with an empty box |
| Cite it in a doc | **Copy link**, then paste `[Exact title](url)` |

Copies are written to `<workspace>/.orca-atlassian/jira/<PROJECT>/<KEY>.md` and
`<workspace>/.orca-atlassian/confluence/<SPACE>/<id>-<title>.md`, in the focused workspace. That
folder has its own `.gitignore` (`*`), so copies never reach git. Each starts with front matter
(key or id, version, URL, fetch time) and a note saying it is read-only. Edits are not sent back;
open it again to refresh.

## Limits

- Read-only: nothing is written to Jira or Confluence.
- Orca has no way for plugins to add items to its link menu, so links go through **Copy link** and
  **Open link** (or the panel's **Open a link** box).
- Orca ignores shortcuts pressed inside a plugin's editor view (such as Markdown Themes), except
  save, so `Ctrl+Shift+L` does nothing there; use the status bar item.
- Images, attachments and draw.io diagrams are links, not pictures. Unknown Confluence macros show
  as *[name macro]* or keep their body.
- Links inside a copy point to Jira or Confluence, not to other copies.
- Desktop app only, and the tabs need a local workspace in focus.

## Develop

```sh
git clone https://github.com/marcelofrau/orca-atlassian
cd orca-atlassian
npm install            # TypeScript and Node types, for the type check only
orca plugin dev load . # prints the approval fingerprint the first time
npm test               # orca plugin test .
npm run check          # orca plugin check .
npm run typecheck
```

| File | What it does |
| --- | --- |
| `src/panel.tsx` | The sidebar panel (Orca components) |
| `src/worker.ts` | The worker: settings, tokens, panel requests and the shortcut command |
| `src/jira.ts`, `src/jira-links.ts`, `src/jira-document.ts` | Jira REST v2 client, keys and JQL, the issue tab |
| `src/confluence.ts`, `src/links.ts` | Confluence REST client, URLs, CQL, file names |
| `src/storage-to-markdown.ts` | Confluence storage format and Jira's rendered HTML to Markdown, no DOM |
| `src/detect.ts` | What a copied text points at |
| `src/tab-file.ts` | The focused workspace and the `.orca-atlassian/` copies |
| `src/clipboard.ts` | The OS clipboard (PowerShell, pbcopy/pbpaste, wl-clipboard or xclip) |
| `src/protocol.ts` | The panel ↔ worker contract |

## License

[GPL-3.0](LICENSE) © Marcelo Frau. Not affiliated with Atlassian.
