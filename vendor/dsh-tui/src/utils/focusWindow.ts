/**
 * DST-Comet: bring another process's window to the foreground.
 *
 * Constellation gives every owner window a `[owner]` title prefix (the label
 * init script on normal pages, and the info tab's own <title>), so the
 * human-wall panel can jump straight to the Chrome window an ask is about.
 * Live-run bug (2026-10-27): a `-like "*[lead]*"` pattern treats [ ] as
 * wildcard character classes and matched an unrelated YouTube window — the
 * needle is now matched with a plain case-insensitive IndexOf, which has no
 * wildcard semantics at all.
 */
import { spawn } from 'node:child_process'

/** Activate the first window whose title contains `needle`. Fire-and-forget:
 *  failures (no match, no PowerShell) surface nowhere — the caller toasts
 *  nothing and the user simply sees no window come up. */
export function focusWindowTitled(needle: string): void {
  if (process.platform !== 'win32' || needle === '') return
  const escaped = needle.replace(/'/g, "''")
  const script =
    `$target = Get-Process chrome -ErrorAction SilentlyContinue ` +
    `| Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowTitle.IndexOf('${escaped}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } ` +
    `| Select-Object -First 1; ` +
    `if ($target) { (New-Object -ComObject WScript.Shell).AppActivate($target.Id) | Out-Null }`
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
}
