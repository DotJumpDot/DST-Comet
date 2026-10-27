/**
 * DST-Comet: bring another process's window to the foreground.
 *
 * Constellation gives every owner window a `[owner]` title prefix, so the
 * human-wall panel can jump straight to the Chrome window an ask is about
 * (user ask 2026-10-27: "make a button that leads me to that Chrome tab").
 * Windows-only by design — the primary platform for this fork.
 */
import { spawn } from 'node:child_process'

/** Activate the first window whose title contains `needle`. Fire-and-forget:
 *  failures (no match, no PowerShell) surface nowhere — the caller toasts
 *  nothing and the user simply sees no window come up. */
export function focusWindowTitled(needle: string): void {
  if (process.platform !== 'win32' || needle === '') return
  const escaped = needle.replace(/'/g, "''")
  const script =
    `$p = Get-Process chrome -ErrorAction SilentlyContinue ` +
    `| Where-Object { $_.MainWindowTitle -like '*${escaped}*' } ` +
    `| Select-Object -First 1; ` +
    `if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }`
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
}
