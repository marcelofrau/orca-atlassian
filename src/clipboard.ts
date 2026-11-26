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
