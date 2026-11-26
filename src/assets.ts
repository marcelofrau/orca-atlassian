// Images and diagrams inside the copies. Orca's editor frames cannot load anything from the network,
// so pictures go into the Markdown itself as data: URLs: attachments and draw.io/Gliffy previews are
// downloaded with the token, PlantUML is drawn on this machine (Java and plantuml.jar, never a
// PlantUML server, so no diagram leaves it). The body says ![alt][asset-1]; the data sits at the end.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Assets } from './storage-to-markdown'

type Fetch = typeof globalThis.fetch

export const IMAGE_MAX_BYTES = 4 * 1024 * 1024
export const TOTAL_MAX_BYTES = 24 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000
const PLANTUML_TIMEOUT_MS = 90_000
const DELIMITER = '@@ORCA-ATLASSIAN-NEXT@@'

/** Fetches one image as a data: URL, or null (not an image, too big, refused, unreachable). */
export type ImageFetcher = (ref: string) => Promise<string | null>
/** Draws PlantUML sources as SVG, in order; null where one failed. */
export type PlantUmlRenderer = (sources: string[]) => Promise<(string | null)[]>

const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`

/**
 * Renders the document twice: first to learn which images and diagrams it has, then, after fetching
 * and drawing them, with those embedded. What could not be embedded stays a link.
 */
export async function withAssets(render: (assets?: Assets) => string, fetchImage: ImageFetcher | null, plantuml: PlantUmlRenderer | null): Promise<string> {
  const refs = new Set<string>()
  const sources = new Set<string>()
  render({ image: (ref) => void (fetchImage && refs.add(ref)), plantuml: (source) => void (plantuml && sources.add(source)) })
  if (!refs.size && !sources.size) return render()

  const images = new Map<string, string>()
  let total = 0
  const queue = [...refs]
  const take = async () => {
    for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
      const url = await fetchImage!(ref).catch(() => null)
      if (url && total + url.length <= TOTAL_MAX_BYTES) {
        images.set(ref, url)
        total += url.length
      }
    }
  }
  const diagrams = [...sources]
  const drawn = diagrams.length ? plantuml!(diagrams).catch(() => [] as (string | null)[]) : Promise.resolve([])
  await Promise.all([take(), take(), take(), take()])
  const svgs = new Map<string, string>()
  ;(await drawn).forEach((svg, i) => {
    if (svg) svgs.set(diagrams[i], dataUrl('image/svg+xml', Buffer.from(svg, 'utf8')))
  })

  const labels = new Map<string, string>()
  const defs: string[] = []
  const label = (key: string, url: string | undefined) => {
    if (!url) return undefined
    let name = labels.get(key)
    if (!name) {
      name = `asset-${labels.size + 1}`
      labels.set(key, name)
      defs.push(`[${name}]: ${url}`)
    }
    return name
  }
  const text = render({ image: (ref) => label(`i:${ref}`, images.get(ref)), plantuml: (source) => label(`p:${source}`, svgs.get(source)) })
  return defs.length ? `${text.trimEnd()}\n\n${defs.join('\n')}\n` : text
}

/**
 * Downloads images from one Atlassian site with its sign-in. `ref` is a file name attached to
 * `attachmentsOf` (a Confluence page id) or a URL; URLs on other hosts are left alone, so the token
 * only goes where it belongs.
 */
export function siteImages(fetch: Fetch, baseUrl: string, authorization: string, attachmentsOf?: string): ImageFetcher {
  const site = new URL(baseUrl)
  return async (ref) => {
    let url: URL
    try {
      url = /^https?:/i.test(ref) ? new URL(ref) : new URL(`${baseUrl}/download/attachments/${attachmentsOf}/${encodeURIComponent(ref)}`)
    } catch {
      return null
    }
    if (url.origin !== site.origin || (!/^https?:/i.test(ref) && !attachmentsOf)) return null
    const response = await fetch(url, { headers: { Authorization: authorization }, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (new URL(response.url || url).origin !== site.origin) return null // redirected off the site: a sign-in page
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!response.ok || !type.startsWith('image/')) return null
    if (Number(response.headers.get('content-length') ?? 0) > IMAGE_MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return bytes.length <= IMAGE_MAX_BYTES ? dataUrl(type, bytes) : null
  }
}

/** plantuml.jar: the setting, PLANTUML_JAR, or where scoop, Homebrew and Linux packages put it. */
export function findPlantUmlJar(setting: unknown, env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const candidates = [
    typeof setting === 'string' ? setting.trim() : '',
    env.PLANTUML_JAR ?? '',
    join(homedir(), 'scoop', 'apps', 'plantuml', 'current', 'plantuml.jar'),
    '/opt/homebrew/opt/plantuml/libexec/plantuml.jar',
    '/usr/local/opt/plantuml/libexec/plantuml.jar',
    '/usr/share/plantuml/plantuml.jar',
    '/usr/share/java/plantuml.jar'
  ]
  return candidates.find((path) => path && exists(path)) ?? null
}

export function javaCommand(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  const home = env.JAVA_HOME?.trim()
  const bin = home ? join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : ''
  return bin && exists(bin) ? bin : 'java'
}

/** Splits PlantUML's -pipe output: one SVG per diagram, each followed by the delimiter. */
export function splitSvgs(output: string, count: number): (string | null)[] {
  const parts = output.split(DELIMITER)
  return Array.from({ length: count }, (_, i) => {
    const part = (parts[i] ?? '').trim()
    return part.startsWith('<svg') || part.startsWith('<?xml') ? part : null
  })
}

/**
 * One Java run for all of a page's diagrams. The smetana layout needs no Graphviz; the INTERNET
 * security profile lets !include reach public libraries (C4-PlantUML) but not local files.
 */
export function localPlantUml(jar: string, java = javaCommand()): PlantUmlRenderer {
  return (sources) =>
    new Promise((resolve) => {
      const input = sources.map((s) => (/@start\w+/.test(s) ? s.trim() : `@startuml\n${s.trim()}\n@enduml`)).join('\n') + '\n'
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(
          java,
          ['-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=INTERNET', '-jar', jar, '-tsvg', '-pipe', '-charset', 'UTF-8', '-Playout=smetana', '-pipedelimitor', DELIMITER],
          { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
        )
      } catch {
        resolve(sources.map(() => null))
        return
      }
      const chunks: Buffer[] = []
      const timer = setTimeout(() => child.kill(), PLANTUML_TIMEOUT_MS)
      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.once('error', () => {
        clearTimeout(timer)
        resolve(sources.map(() => null))
      })
      // A diagram with a syntax error still yields an SVG (PlantUML draws the error), with a non-zero exit.
      child.once('close', () => {
        clearTimeout(timer)
        resolve(splitSvgs(Buffer.concat(chunks).toString('utf8'), sources.length))
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(input, 'utf8')
    })
}
