/**
 * DST Comet tool-card tone: one family per tool kind, one theme token per
 * family, and a per-family card wash derived from that token. The transcript
 * used to paint every tool name (and every card surface) in the same mist
 * blue; Read / Grep / Pwsh / MCP now read apart at a glance while staying
 * inside the active theme (the wash is a blend of the family token and the
 * theme's own card surface, so `comet`, `dark`, light and ANSI palettes all
 * keep their identity).
 */
import type { Theme } from '../../theme.js'
import type { Color } from '../../ink/styles.js'
import { interpolateColor, parseRGB, toRGBColor } from '../Spinner/spinnerUtils.js'

/** The card tone families. `default` keeps the theme accent. */
export type ToolToneFamily = 'read' | 'search' | 'exec' | 'mutate' | 'web' | 'task' | 'mcp' | 'default'

const READ_TOOLS = new Set([
  'read',
  'read_file',
  'readfile',
  'fileread',
  'view_image',
  'viewimage',
])

const SEARCH_TOOLS = new Set([
  'grep',
  'glob',
  'search',
  'file_search',
  'find',
  'ripgrep',
  'list_dir',
  'ls',
])

const EXEC_TOOLS = new Set([
  'bash',
  'bashpersistent',
  'powershell',
  'pwsh',
  'sh',
  'shell',
  'terminal',
  'exec',
  'execute_command',
  'run_command',
  'run_shell_command',
])

const MUTATE_TOOLS = new Set([
  'edit',
  'write',
  'multiedit',
  'notebookedit',
  'str_replace_editor',
  'apply_patch',
  'patch',
])

const WEB_TOOLS = new Set([
  'web_search',
  'web_fetch',
  'browser',
  'fetch',
  'websearch',
])

const TASK_TOOLS = new Set([
  'subagent',
  'task',
  'workflow',
  'job',
  'spawn_teammate',
  'send_message',
  'list_agents',
  'team_task',
  'team_tasks',
  'team_message',
])

/**
 * Which colour family a tool belongs to. The backend-declared category wins
 * where it is decisive (mutate/exec); otherwise the tool id decides. An MCP
 * tool id always wins: the DSH MCP client registers `mcp__<server>__<tool>`
 * and those cards should read as their own family even when the server tool
 * happens to be named `read`.
 *
 * @param raw - Raw tool id (`read`, `grep`, `mcp__playwright__…`).
 * @param category - Backend-declared colour family, if any.
 * @returns the family to paint with.
 */
export function toolToneFamily(raw: string, category?: 'mutate' | 'exec' | 'other'): ToolToneFamily {
  const name = raw.toLowerCase()
  if (name.startsWith('mcp__') || name.startsWith('mcp_') || name.includes('__mcp__')) return 'mcp'
  if (category === 'mutate') return 'mutate'
  if (category === 'exec') return 'exec'
  if (category === 'other') return 'task'
  if (READ_TOOLS.has(name)) return 'read'
  if (SEARCH_TOOLS.has(name)) return 'search'
  if (EXEC_TOOLS.has(name)) return 'exec'
  if (MUTATE_TOOLS.has(name)) return 'mutate'
  if (WEB_TOOLS.has(name)) return 'web'
  if (TASK_TOOLS.has(name)) return 'task'
  return 'default'
}

/** Theme token that carries a family's foreground colour. Read/Write/Web/
 *  Task reuse the status-dot palette so dot and title never disagree. */
export function toolToneColor(family: ToolToneFamily): keyof Theme {
  switch (family) {
    case 'read': return 'toolDotRead'
    case 'search': return 'toolNameSearch'
    case 'exec': return 'toolNameExec'
    case 'mutate': return 'toolNameMutate'
    case 'web': return 'toolDotWeb'
    case 'task': return 'toolDotTask'
    case 'mcp': return 'toolNameMcp'
    default: return 'accent'
  }
}

/** How strong the card wash is: the settings `toolBackground` level, plus the
 *  hover step. `none` paints no wash at all. */
export type ToolWash = 'none' | 'subtle' | 'strong' | 'hover'

const WASH_STRENGTH: Readonly<Record<Exclude<ToolWash, 'none'>, number>> = Object.freeze({
  subtle: 0.16,
  strong: 0.24,
  hover: 0.34,
})

/**
 * The card surface for one family: the theme's card shade blended toward the
 * family colour. Truecolor themes get a real tint; ANSI themes (and any
 * non-`rgb()` token) keep their own card shade, because a 16-colour terminal
 * cannot express the blend and a random ANSI hue would be worse than none.
 *
 * @param theme - Active palette.
 * @param family - Card tone family.
 * @param wash - Requested strength (`none` = transparent).
 * @returns a raw background colour, or undefined for transparent.
 */
export function toolCardWash(theme: Theme, family: ToolToneFamily, wash: ToolWash): Color | undefined {
  if (wash === 'none') return undefined
  const base = wash === 'subtle' ? theme.toolCardBackgroundDim : theme.toolCardBackground
  if (base === '') return undefined
  const baseRgb = parseRGB(base)
  const toneRgb = parseRGB(theme[toolToneColor(family)] ?? '')
  if (baseRgb === null || toneRgb === null) return base as Color
  return toRGBColor(interpolateColor(baseRgb, toneRgb, WASH_STRENGTH[wash]))
}

/** Card-level `toolBackground` setting → wash strength for the ordinary
 *  (unhovered) surface. */
export function toolWashOf(toolBackground: 'none' | 'subtle' | 'strong'): ToolWash {
  return toolBackground
}
