/**
 * Compact cards for DSH's experimental Agent Teams tools. Their results are
 * compact JSON records and the tools ship no presenters, so the plain card
 * would show a capitalised tool id and a raw `⎿ {"messageId":…}` line. These
 * views fold known shapes into one line; anything else (an error text, a
 * changed upstream shape) falls back to the plain card. A presenter the tool
 * itself registers always wins: these run only when it has none.
 * `spawn_teammate` is not here — it renders as the subagent row, and as a
 * plain card only when it fails before the teammate exists (translate.ts).
 *
 * Three names are shared with the legacy subagent controls, which also ship
 * no presenters: a team call is told apart by its `target` argument (the
 * legacy ones take `agent_id`), a team result by its record shape.
 *
 * {@link teamMessageOf} reads a delivered team message for the transcript
 * translator.
 *
 * @module
 */

import { agentRelaySourceOf } from '../agent/messages.js'
import type { ToolCallView, ToolResultView } from './channel/types.js'
import { legacySendMessageStatus } from './compat/agent-team-0.2.0.js'

type Args = Record<string, unknown>

const DISPLAY_KEYS: Readonly<Record<string, string>> = {
  send_message: 'tool-name-team-message',
  list_agents: 'tool-name-team-roster',
  wait_agent: 'tool-name-team-wait',
  interrupt_agent: 'tool-name-team-interrupt',
  team_task_create: 'tool-name-team-task',
  team_task_list: 'tool-name-team-task',
  team_task_get: 'tool-name-team-task',
  team_task_update: 'tool-name-team-task',
  // DST-Comet engine-fork tools: without a card each rendered as a raw
  // capitalized id plus a JSON blob — the human-wall queue especially needs
  // to be readable in the transcript.
  human_task_create: 'tool-name-team-human-task',
  human_task_list: 'tool-name-team-human-task',
  human_task_wait: 'tool-name-team-human-task',
  human_task_resolve: 'tool-name-team-human-task',
  lane_freeze: 'tool-name-team-lane',
  lane_resume: 'tool-name-team-lane',
  team_snapshot: 'tool-name-team-snapshot',
  release_teammate: 'tool-name-team-release',
}

/** The team's own delegation tool; its presence is what "team on" means to a request. */
export const TEAM_SPAWN_TOOL = 'spawn_teammate'

/** Whether `name` is a team tool with a compact card here (not `spawn_teammate`). */
export function isTeamToolName(name: string): boolean {
  return DISPLAY_KEYS[name] !== undefined
}

function isRecord(value: unknown): value is Args {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function firstLine(text: string): string {
  return text.split('\n', 1)[0]!.trim()
}

function callTitle(name: string, args: Args): string | undefined {
  switch (name) {
    case 'send_message': {
      const target = str(args.target)
      if (target === undefined) return undefined
      const message = str(args.message)
      return message === undefined ? `→ ${target}` : `→ ${target} · ${firstLine(message)}`
    }
    // `list_agents` / `wait_agent` calls carry nothing that tells them from the
    // legacy subagent controls of the same names; only their results do.
    case 'interrupt_agent':
      return str(args.target)
    case 'team_task_create':
      return str(args.subject)
    case 'team_task_list':
      return ['status', 'owner', 'ready'].flatMap(key => (args[key] === undefined ? [] : [`${key}=${String(args[key])}`])).join(' ') || undefined
    case 'team_task_get':
      return str(args.task_id)
    case 'team_task_update': {
      const id = str(args.task_id)
      const action = str(args.action)
      if (id === undefined || action === undefined) return undefined
      const owner = str(args.owner)
      return owner === undefined ? `${id} ${action}` : `${id} ${action} → ${owner}`
    }
    case 'human_task_create': {
      const title = str(args.title)
      if (title === undefined) return undefined
      const lane = str(args.lane)
      const owner = str(args.owner)
      return [lane === undefined ? undefined : `[${lane}]`, title, owner === undefined ? undefined : `park ${owner}`].filter(part => part !== undefined).join(' ')
    }
    case 'human_task_list':
      return args.waiting_only === true ? 'waiting only' : undefined
    case 'human_task_wait':
      return str(args.task_id) ?? 'own task'
    case 'human_task_resolve': {
      const id = str(args.task_id)
      const outcome = str(args.outcome)
      return id === undefined || outcome === undefined ? undefined : `${id} · ${outcome}`
    }
    case 'lane_freeze':
    case 'lane_resume': {
      const target = str(args.target)
      if (target === undefined) return undefined
      const note = str(args.note)
      return note === undefined ? target : `${target} · ${firstLine(note)}`
    }
    case 'release_teammate':
      return str(args.target)
    default:
      return undefined
  }
}

/**
 * Call card for a team tool without its own presenter.
 * @param name - Tool name.
 * @param rawArgs - The call's JSON arguments.
 * @returns the card, or `undefined` when this is not a team tool call it knows.
 */
export function teamToolCallView(name: string, rawArgs: string): ToolCallView | undefined {
  const displayKey = DISPLAY_KEYS[name]
  if (displayKey === undefined) return undefined
  const title = titleOf(name, rawArgs)
  return title === undefined ? undefined : { card: 'generic', title, displayKey, category: 'other' }
}

function titleOf(name: string, rawArgs: string): string | undefined {
  let args: unknown
  try { args = JSON.parse(rawArgs) } catch { return undefined }
  return isRecord(args) ? callTitle(name, args) : undefined
}

function taskLine(task: Args): string | undefined {
  const id = str(task.id)
  const status = str(task.status)
  if (id === undefined || status === undefined || typeof task.revision !== 'number') return undefined
  const owner = str(task.ownerName)
  return `${id} r${task.revision} · ${status}${owner === undefined ? '' : ` · ${owner}`}`
}

function resultLine(name: string, value: unknown): string | undefined {
  switch (name) {
    case 'send_message':
      if (!isRecord(value)) return undefined
      if (value.sent === true) return 'sent'
      // compat(dsh 0.2.0, log): the mailbox status a 0.2.0 send answered.
      return legacySendMessageStatus(value)
    case 'list_agents': {
      if (!Array.isArray(value)) return undefined
      const members = value.flatMap(member => (isRecord(member) && str(member.target) !== undefined && str(member.status) !== undefined
        ? [`${String(member.target)} ${String(member.status)}`]
        : []))
      return members.length === value.length ? members.join(' · ') : undefined
    }
    case 'wait_agent':
      if (!isRecord(value)) return undefined
      if (value.noProgress) return 'noProgress'
      if (typeof value.timedOut !== 'boolean') return undefined
      if (value.user_input === true) return 'user input arrived'
      if (value.inbox_message === true) return 'peer message arrived'
      if (value.interrupted === true) return 'interrupted'
      if (value.timedOut) return 'timedOut'
      {
        // DST-Comet wake reasons: what moved, so the card line is actionable
        // (`changed task task-3 · fixture signup matrix`) instead of "changed".
        const changed = str(value.changed)
        if (changed === undefined) return 'changed'
        const target = str(value.target)
        const detail = str(value.detail)
        const head = `changed ${changed}${target === undefined ? '' : ` ${target}`}`
        return detail === undefined ? head : `${head} · ${firstLine(detail).slice(0, 60)}`
      }
    case 'interrupt_agent':
      return isRecord(value) ? str(value.previousStatus) : undefined
    case 'team_task_list': {
      if (!isRecord(value) || !Array.isArray(value.tasks)) return undefined
      const tasks = value.tasks.map(task => (isRecord(task) ? taskLine(task) : undefined))
      if (tasks.includes(undefined)) return undefined
      return tasks.join('\n')
    }
    case 'team_task_create':
    case 'team_task_get':
    case 'team_task_update':
      return isRecord(value) ? taskLine(value) : undefined
    case 'human_task_create': {
      if (!isRecord(value) || !isRecord(value.task)) return undefined
      return humanTaskLine(value.task)
    }
    case 'human_task_list': {
      if (!isRecord(value) || !Array.isArray(value.tasks)) return undefined
      const lines = value.tasks.map(task => (isRecord(task) ? humanTaskLine(task) : undefined))
      if (lines.includes(undefined)) return undefined
      const frozen = Array.isArray(value.frozenLanes) ? value.frozenLanes.length : 0
      return [...(lines as string[]), ...(frozen > 0 ? [`${frozen} frozen lane(s)`] : [])].join('\n')
    }
    case 'human_task_wait':
      if (!isRecord(value)) return undefined
      if (value.timedOut === true) return 'timedOut'
      if (isRecord(value.woke) && str(value.woke.task_id) !== undefined)
        return `woke ${String(value.woke.task_id)} · ${String(value.woke.outcome ?? '')}`.trimEnd()
      return undefined
    case 'human_task_resolve':
      if (!isRecord(value) || value.resolved !== true) return undefined
      return [
        'resolved',
        value.notified_member === true ? 'member woken' : undefined,
        value.board_completed === true ? 'mirror completed' : undefined,
      ].filter(part => part !== undefined).join(' · ')
    case 'lane_freeze':
    case 'lane_resume':
      if (!isRecord(value) || str(value.member) === undefined || str(value.state) === undefined) return undefined
      return `${String(value.member)} · ${String(value.state)}`
    case 'team_snapshot': {
      if (!isRecord(value) || !Array.isArray(value.members)) return undefined
      const members = value.members.flatMap(member => (isRecord(member) && str(member.target) !== undefined && str(member.status) !== undefined
        ? [`${String(member.target)} ${String(member.status)}` + (member.waitingOnHuman !== undefined ? ' ⚠human' : '') + (member.frozen !== undefined ? ' ❄frozen' : '')]
        : []))
      if (members.length !== value.members.length) return undefined
      const open = typeof value.openHumanTasks === 'number' ? value.openHumanTasks : 0
      const frozen = typeof value.frozenLanes === 'number' ? value.frozenLanes : 0
      return [...members, ...(open > 0 || frozen > 0 ? [`${open} human · ${frozen} frozen`] : [])].join('\n')
    }
    case 'release_teammate':
      if (!isRecord(value) || value.released !== true || str(value.member) === undefined) return undefined
      return `${String(value.member)} released${value.stopped_live_child === true ? ' (live session stopped)' : ''}`
    default:
      return undefined
  }
}

/** One human task row: `ht-… · waiting · [lane]`. */
function humanTaskLine(task: Args): string | undefined {
  const id = str(task.id)
  const status = str(task.status)
  if (id === undefined || status === undefined) return undefined
  const lane = str(task.lane)
  return `${id} · ${status}${lane === undefined ? '' : ` · [${lane}]`}`
}

/**
 * Result card for a team tool without its own presenter. It replaces the
 * call card, so it carries the call's title too.
 * @param name - Tool name.
 * @param rawArgs - The call's JSON arguments.
 * @param text - The result's text content.
 * @returns the card, or `undefined` for anything but a known result record.
 */
export function teamToolResultView(name: string, rawArgs: string, text: string): ToolResultView | undefined {
  const displayKey = DISPLAY_KEYS[name]
  if (displayKey === undefined || !text.startsWith('{') && !text.startsWith('[')) return undefined
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  const line = resultLine(name, value)
  if (line === undefined) return undefined
  const title = titleOf(name, rawArgs)
  return {
    card: 'generic', displayKey, category: 'other',
    ...title === undefined || title === '' ? {} : { title },
    content: line === '' ? [] : line.split('\n').map(text => ({ type: 'text', text })),
  }
}

/** Relay framing: one whole leading block, `Team message from <name>:`. */
const RELAY_FRAMING = /^Team message from ([^\n]+):$/

/**
 * An Agent Teams message delivered to a session (`user/message`): the
 * generic relay (`agent-message` / `relay`) whose first block is exactly
 * `Team message from <name>:`. A relay is any agent's message (the legacy
 * `send_message` writes one too), so only the team's framing block marks it
 * as a team message; the sender label replaces that block. The relay also
 * reaches the agent-message feed, which owns it on a teammate's own pages;
 * this reading is for the receiving transcript. A 0.2.0 log is read through
 * `compat/agent-team-0.2.0.ts` first.
 */
export function teamMessageOf<B extends { readonly type: string }>(source: unknown, content: readonly B[]): { sender: string; blocks: readonly B[]; text: string } | undefined {
  const first = content[0] as { type: string; text?: unknown } | undefined
  const framing = agentRelaySourceOf(source) !== undefined && first?.type === 'text' && typeof first.text === 'string'
    ? RELAY_FRAMING.exec(first.text)
    : null
  if (framing === null) return undefined
  const sender = framing[1]!
  const blocks = content.slice(1)
  const text = blocks
    .flatMap(block => {
      const value = (block as { text?: unknown }).text
      return block.type === 'text' && typeof value === 'string' ? [value] : []
    })
    .join('\n')
    .trim()
  return { sender, blocks, text }
}
