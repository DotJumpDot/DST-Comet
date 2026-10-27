/**
 * DST Comet sidebar brand: which mascot rides above the panel bar, and how
 * tall that header is. The choice is a per-machine UI preference (like the
 * language and home-screen prefs next to it), not a deployment option: a
 * click on the logo cycles it, and `~/.dsh-tui/sidebar-logo.json` remembers
 * the pick across launches. An unreadable or unwritable file is never fatal.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../../utils/paths.js'

/** What sits left of the wordmark. `none` gives the text row 0 the full
 *  width (the header still reserves the vertical space, so the panel bar
 *  never jumps when cycling). */
export type SidebarLogoVariant = 'whaleGirl' | 'whale' | 'none'

export const SIDEBAR_LOGO_VARIANTS = ['whaleGirl', 'whale', 'none'] as const

/** Mascot rows on a roomy terminal: a 24×16 sprite (8 half-block rows)
 *  beside the two-line wordmark, so the character keeps its face detail. */
export const SIDEBAR_BRAND_ROWS = 8

/** Large bottom-placement sprite rows (28×20 pixels = 10 text rows). The
 *  panel foot has no wordmark beside the art, so a wider panel buys straight
 *  resolution (user ask 2026-10-27: the sidebar sample read low-pixel next
 *  to the chat column's whale girl). */
export const SIDEBAR_BRAND_ROWS_LARGE = 10

/** Breathing row between the mascot block and the panel bar. */
export const SIDEBAR_BRAND_GAP = 1

/** Total rows above the panel bar on a roomy terminal, or the compact 2-row
 *  mascot strip on a short one (always including the gap). A 24-column
 *  mascot needs a wide sidebar too; narrower columns keep the text only.
 *  `bottom` placement parks the mascot at the panel foot instead, so the
 *  header is always the text-only two rows — the position setting
 *  (`dsh-tui.sidebarLogoPosition`) rides the display-pref chain. */
export function sidebarBrandRows(terminalRows: number, panelWidth = 0, position: 'top' | 'bottom' = 'top'): number {
  if (position === 'bottom') return 2 + SIDEBAR_BRAND_GAP
  return terminalRows >= 30 && panelWidth >= 42
    ? SIDEBAR_BRAND_ROWS + SIDEBAR_BRAND_GAP
    : 2 + SIDEBAR_BRAND_GAP
}

/** Mascot text rows for the bottom placement: the large 28×20 sprite on a
 *  tall + wide panel, the regular 8-row sprite on a roomy terminal, the
 *  compact 2-row strip on a short one. Width 0 (caller unknown) keeps the
 *  regular sizes so existing probes stay meaningful. */
export function sidebarMascotRows(terminalRows: number, panelWidth = 0): number {
  if (terminalRows < 30) return 2
  return panelWidth >= 32 ? SIDEBAR_BRAND_ROWS_LARGE : SIDEBAR_BRAND_ROWS
}

const PREFS_FILE = join(DATA_DIR, 'sidebar-logo.json')

function normalize(value: unknown): SidebarLogoVariant {
  return typeof value === 'string' && (SIDEBAR_LOGO_VARIANTS as readonly string[]).includes(value)
    ? value as SidebarLogoVariant
    : 'whaleGirl'
}

function readPersisted(): SidebarLogoVariant {
  try {
    const parsed: unknown = JSON.parse(readFileSync(PREFS_FILE, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return 'whaleGirl'
    return normalize((parsed as { logo?: unknown }).logo)
  } catch {
    return 'whaleGirl'
  }
}

let current: SidebarLogoVariant = readPersisted()
const listeners = new Set<() => void>()

/** Subscribe to logo changes (useSyncExternalStore contract). */
export function subscribeSidebarLogo(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The active mascot. */
export function getSidebarLogo(): SidebarLogoVariant {
  return current
}

/** Persist and apply one mascot pick; returns what was applied. */
export function applySidebarLogo(value: unknown): SidebarLogoVariant {
  const next = normalize(value)
  if (next === current) return current
  current = next
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(PREFS_FILE, `${JSON.stringify({ logo: next }, null, 2)}\n`, 'utf8')
  } catch {
    // A read-only data dir keeps the in-memory choice for this run.
  }
  for (const listener of listeners) listener()
  return current
}

/** Click handler: whale girl → whale → none → whale girl. */
export function cycleSidebarLogo(): SidebarLogoVariant {
  const index = SIDEBAR_LOGO_VARIANTS.indexOf(current)
  return applySidebarLogo(SIDEBAR_LOGO_VARIANTS[(index + 1) % SIDEBAR_LOGO_VARIANTS.length]!)
}
