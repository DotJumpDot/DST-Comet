/**
 * Data-directory paths for the dsh-tui profile. All preferences and history
 * live under `~/.dsh-tui`.
 *
 * The compiled copy (lib/types/utils/paths.js) is also imported by the bin
 * launcher, mirroring the shellQuote precedent.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The user's home directory. `os.homedir()` first; the USERPROFILE/HOME
 * spellings are the last-resort fallback for stripped-down environments.
 * @returns Absolute home path.
 */
export function homeDir(): string {
  return homedir() || process.env.USERPROFILE || process.env.HOME || ''
}

/** Data directory all preferences/history live in (`~/.dsh-tui` by default).
 *
 * `DSH_TUI_STATE_DIR` overrides it PER LAUNCHER (fork-isolation ask
 * 2026-10-30): every dsh-tui-family build hard-codes the same `~/.dsh-tui`,
 * so a second fork profile (DST-Moon) running the same TUI line rewrote
 * comet's settings/theme/mount-ledger/agent-view state and back. The comet
 * launcher pins its own dir; anything else (upstream, other forks) keeps the
 * default and the two can never touch each other's state again. On first use
 * of the override, the legacy dir's files are copied over ONCE (except
 * regenerable caches) so preferences survive the move. */
export const DATA_DIR = resolveDataDir()

function resolveDataDir(): string {
  const override = process.env.DSH_TUI_STATE_DIR
  if (override === undefined || override.trim() === '') return join(homeDir(), '.dsh-tui')
  const target = override.trim()
  const legacy = join(homeDir(), '.dsh-tui')
  if (target === legacy) return target
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true })
      // One-time migration: carry preferences/history into the fork's own
      // dir. compile-cache is regenerable and can be large; *.log files are
      // transient. Everything else (settings, theme, ledgers, backends/,
      // inject/, …) is small and load-bearing.
      if (fs.existsSync(legacy)) {
        for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
          if (entry.name === 'compile-cache' || entry.name.endsWith('.log')) continue
          try {
            fs.cpSync(join(legacy, entry.name), join(target, entry.name), { recursive: true })
          } catch { /* best effort — a locked file must not block the boot */ }
        }
      }
    }
  } catch { /* unreadable/undiskable override: the writers fail loudly later */ }
  return target
}

/**
 * Where one backend keeps its own files: `<dataRoot>/backends/<id>`, keyed by
 * the backend's declared id (the `x-dsh-tui` Backend entry's `spec.id` field).
 * The single construction point, so a check for what a removal
 * left behind reads the same path the backend wrote to (C-5).
 *
 * `dataRoot` defaults to this profile's own `~/.dsh-tui`. It is a parameter so
 * that a regression can point the whole check at a temporary tree, exactly like
 * the diagnostics' own `dataDir` override.
 */
export function backendDataDir(backendId: string, dataRoot: string = DATA_DIR): string {
  return join(dataRoot, 'backends', backendId)
}
