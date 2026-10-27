/**
 * DST-Comet: human-wall queue projection for the side panel.
 *
 * The engine's human_task_create mirrors every human-gated step onto the
 * shared task board as `[human] <title>` with the steps, the done_when
 * post-condition, and a machine-readable `human-meta:` footer (id, lane,
 * member, preserve_url/tab, park flag). The session log is the source of
 * truth — this module only projects board tasks into the panel's view model,
 * so a reopened session rebuilds the queue from the log alone.
 */

import type { TeamTask } from '../../adapter/ports/channel-view.js'

/** One human-gated ask as the panel renders it. */
export interface HumanWallItem {
  /** Board mirror task id (always present; the resolve hint prefers humanId). */
  readonly id: string
  /** Human task id from the meta footer (`ht-…`) when the new engine wrote it. */
  readonly humanId?: string
  readonly title: string
  readonly lane?: string
  /** Parked member when known; falls back to the board task's owner. */
  readonly member?: string
  readonly steps: readonly string[]
  readonly doneWhen: string
  readonly preserveUrl?: string
  readonly preserveTab?: string
  /** false → tracked-only ask (the Lead queued it with park:false). */
  readonly parked: boolean
  readonly open: boolean
}

const HUMAN_PREFIX = '[human] '
const META_RE = /human-meta: (\{.*\})/

/** Parse one board task into a human-wall item; undefined for normal tasks. */
export function parseHumanTask(task: TeamTask): HumanWallItem | undefined {
  if (!task.subject.startsWith(HUMAN_PREFIX)) return undefined
  const steps: string[] = []
  let doneWhen = ''
  let humanId: string | undefined
  let lane: string | undefined
  let member: string | undefined
  let preserveUrl: string | undefined
  let preserveTab: string | undefined
  let parked = true
  for (const line of task.description.split('\n')) {
    if (line.startsWith('human-meta: ')) {
      try {
        const meta = JSON.parse(line.slice('human-meta: '.length)) as Record<string, unknown>
        if (typeof meta.id === 'string') humanId = meta.id
        if (typeof meta.lane === 'string') lane = meta.lane
        if (typeof meta.member === 'string') member = meta.member
        if (typeof meta.preserve_url === 'string') preserveUrl = meta.preserve_url
        if (typeof meta.preserve_tab === 'string') preserveTab = meta.preserve_tab
        if (meta.park === false) parked = false
      } catch {
        /* legacy mirror whose footer is not parseable JSON — steps still show */
      }
      continue
    }
    const step = /^(\d+)\. (.*)$/.exec(line)
    if (step !== null) {
      steps.push(step[2]!)
      continue
    }
    const done = /^Done when: (.*)$/.exec(line)
    if (done !== null) doneWhen = done[1]!
  }
  return {
    id: task.id,
    ...(humanId === undefined ? {} : { humanId }),
    title: task.subject.slice(HUMAN_PREFIX.length),
    ...(lane === undefined ? {} : { lane }),
    member: member ?? task.ownerName,
    steps,
    doneWhen,
    ...(preserveUrl === undefined ? {} : { preserveUrl }),
    ...(preserveTab === undefined ? {} : { preserveTab }),
    parked,
    open: task.status !== 'completed',
  }
}

/** Project the team board into panel rows: open asks newest-first, then the
 *  two most recently resolved ones (dim, for follow-up context). */
export function humanWallItems(team: { readonly tasks: readonly TeamTask[] } | undefined): HumanWallItem[] {
  const items = (team?.tasks ?? [])
    .map(parseHumanTask)
    .filter((item): item is HumanWallItem => item !== undefined)
  const open = items.filter(item => item.open).reverse()
  const resolved = items.filter(item => !item.open).slice(-2).reverse()
  return [...open, ...resolved]
}

/** Which window label the "focus Chrome" action should activate: Constellation
 *  prefixes every owner page title with `[owner]`. */
export function ownerWindowLabel(item: HumanWallItem): string {
  return `[${item.lane ?? item.member ?? 'shared'}]`
}
