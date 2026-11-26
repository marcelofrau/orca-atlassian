// Orca has no clipboard API for workers, so this asks the OS: PowerShell on Windows, pbcopy on
// macOS, wl-copy or xclip on Linux. The text goes through stdin, never the command line.
import { spawn } from 'node:child_process'

const TIMEOUT_MS = 10_000

// Reads stdin as UTF-8 and sets it as Unicode text, so accents and dashes in titles survive.
const WINDOWS_SCRIPT =
  '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Windows.Forms; ' +
  '$in = [Console]::OpenStandardInput(); $ms = New-Object System.IO.MemoryStream; $in.CopyTo($ms); ' +
  '$text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()); ' +
  '[System.Windows.Forms.Clipboard]::SetText($text, [System.Windows.Forms.TextDataFormat]::UnicodeText)'

function run(file: string, args: string[], input: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, TIMEOUT_MS)
    child.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input, 'utf8')
  })
}

export async function copyText(text: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT], text)
  if (platform === 'darwin') return run('pbcopy', [], text)
  return (await run('wl-copy', [], text)) || run('xclip', ['-selection', 'clipboard'], text)
}

// Writes the clipboard as UTF-8 bytes to stdout, so accents survive the console code page.
const WINDOWS_READ_SCRIPT =
  '$ErrorActionPreference = "Stop"; Add-Type -AssemblyName System.Windows.Forms; ' +
  '$text = [System.Windows.Forms.Clipboard]::GetText(); $bytes = [System.Text.Encoding]::UTF8.GetBytes($text); ' +
  '$out = [Console]::OpenStandardOutput(); $out.Write($bytes, 0, $bytes.Length)'

/** The clipboard's text, or null when it cannot be read. At most 64 KiB, which is plenty for a link. */
function capture(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (size < 65_536) chunks.push(chunk)
      size += chunk.length
    })
    child.once('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? Buffer.concat(chunks).toString('utf8').slice(0, 65_536) : null)
    })
  })
}

export async function readText(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (platform === 'win32') return capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_READ_SCRIPT])
  if (platform === 'darwin') return capture('pbpaste', [])
  return (await capture('wl-paste', ['--no-newline'])) ?? capture('xclip', ['-selection', 'clipboard', '-o'])
}
