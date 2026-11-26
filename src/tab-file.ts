// Read-only page copies live in `<workspace>/.orca-confluence/`, which carries its own `.gitignore`
// (`*`) so they never reach git. Orca opens them in its own Markdown view (or a Markdown plugin's).
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const TAB_FOLDER = '.orca-confluence'

export type HostCall = (method: string, params?: unknown) => Promise<any>
export interface Workspace { id: string; path: string }

/** The focused workspace when it is on this machine; null otherwise. */
export async function focusedWorkspace(call: HostCall): Promise<Workspace | null> {
  const context: { workspaceId?: string; branch: string; displayName: string } | null = await call('workspace.readContext')
  if (!context) return null
  const { workspaces }: { workspaces: { id: string; kind: string; name: string; path: string; branch: string | null; hostId: string | null }[] } =
    await call('workspace.list')
  const local = workspaces.filter((w) => w.hostId === null || w.hostId === 'local')
  const byId = context.workspaceId ? local.find((w) => w.id === context.workspaceId) : undefined
  if (byId) return { id: byId.id, path: byId.path }
  const byName = local.filter((w) => w.name === context.displayName && (w.kind === 'folder' || w.branch === context.branch))
  return byName.length === 1 ? { id: byName[0].id, path: byName[0].path } : null
}

/** Writes `relative` under the tab folder (only when it changed) and answers its workspace path. */
export async function writeTabFile(workspacePath: string, relative: string, text: string): Promise<string> {
  const parts = relative.split(/[\\/]/)
  if (path.isAbsolute(relative) || parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`bad file name: ${relative}`)
  const folder = path.join(workspacePath, TAB_FOLDER)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error
  })
  const file = path.join(folder, ...parts)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const current = await fs.readFile(file, 'utf8').catch(() => null)
  if (current !== text) await fs.writeFile(file, text, 'utf8')
  return [TAB_FOLDER, ...parts].join('/')
}
