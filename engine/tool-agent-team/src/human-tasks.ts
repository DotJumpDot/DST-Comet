/**
 * DST-Comet: human-gated steps and lane parking for Agent Teams.
 *
 * Live-run findings (Advice/agent-team-hunt-run-2026-10-26.md): a teammate
 * that hits a captcha/login wall had to message the Lead, the Lead had to
 * interrupt it, ask the human, and re-wake it — every handoff burned Lead
 * context; and the Lead's only parking lever, interrupt_agent, could cut a
 * tool call mid-flight. This module owns two registries consulted by a
 * tools guard instead:
 *
 *  - a human task queue: `human_task_create` parks the CALLING agent (its
 *    next gated tool call is refused with the reason) without killing its
 *    turn or page state; any member resolves it, which auto-wakes the parked
 *    agent with the outcome and the post-condition it must re-verify; and
 *  - lane freeze: the Lead parks a teammate between tool calls; the current
 *    call finishes because guards only run before dispatch.
 *
 * Every transition appends one JSONL audit line to the workspace so a run
 * can cite human-in-the-loop provenance.
 *
 * @module tool-agent-team/human-tasks
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** Resolution chosen for one human task. `delegated` (run 4 advice §8c): the
 *  human handed the DECISION back to the agent — the record must distinguish
 *  "human decided X" from "human told the agent to decide". */
export type HumanTaskOutcome = 'done' | 'failed' | 'skip' | 'delegated'

/** One queued human-gated step. */
export interface HumanTask {
  readonly id: string
  readonly teamId: string
  readonly lane?: string
  title: string
  steps: string[]
  doneWhen: string
  readonly memberName: string
  readonly memberId: string
  readonly preserveTab?: string
  readonly preserveUrl?: string
  readonly createdAt: string
  /** Idempotency key (run-7 P1-5): the Lead and the lane both raised the same
   *  wall 19 s apart and the human saw two near-identical asks. */
  readonly dedupeKey?: string
  /** Shared task-board mirror task id and its last-seen revision (written
   *  once after the board task exists, so they are mutable fields). */
  boardTaskId?: string
  boardRevision?: number
  resolvedAt?: string
  outcome?: HumanTaskOutcome
  resolvedBy?: string
  summary?: string
}

/** One Lead-issued lane park. */
export interface FreezeRecord {
  readonly memberName: string
  readonly by: string
  readonly note?: string
  readonly at: string
}

/** Input accepted by {@link TeamOps.create}. */
export interface HumanTaskInput {
  /** Explicit task id (supplied by the caller when the board-mirror description must embed it). */
  readonly id?: string
  readonly lane?: string
  readonly title: string
  readonly steps: readonly string[]
  readonly doneWhen: string
  readonly preserveTab?: string
  readonly preserveUrl?: string
  /** Idempotency key: one open task per key within the dedupe window. */
  readonly dedupeKey?: string
}

/** How long a dedupe_key suppresses a second identical ask (ms). */
export const DEDUPE_WINDOW_MS = 15 * 60_000

/** Fields human_task_update may edit on an open wall (run-7 P1-5: a tunnel
 *  URL was baked into the steps and the only fix was resolve-as-skip and
 *  re-raise). */
export interface HumanTaskEdit {
  readonly title?: string
  readonly steps?: readonly string[]
  readonly doneWhen?: string
}

/** Parking options for {@link TeamOps.create}. */
export interface CreateOptions {
  /**
   * Member whose lane parks on this task. Defaults to the creating member;
   * pass another member id when the Lead queues a step for a lane, or null to
   * queue a human step without parking anyone (the Lead stays running).
   */
  readonly parkMemberId?: string | null
}

/** Generate the model-facing human task id (also usable before create). */
export function newHumanTaskId(): string {
  return `ht-${randomUUID().slice(0, 8)}`
}

/**
 * Tools a paused agent may still call. Reads, messaging, and the human-task
 * lifecycle stay available so the agent can wait and report; every mutating
 * or target-touching tool is refused until the human step resolves.
 */
export const PAUSE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'human_task_wait',
  'human_task_list',
  'human_task_resolve',
  'team_snapshot',
  'list_agents',
  'send_message',
  'team_task_list',
  'team_task_get',
  'wait_agent',
])

/** Tools a frozen agent may still call; lane freeze is stricter than a human pause. */
export const FREEZE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'team_snapshot',
  'list_agents',
  'send_message',
  'human_task_list',
  'team_task_list',
  'team_task_get',
  'wait_agent',
])

interface TaskWaiter {
  readonly taskId: string
  readonly notify: () => void
}

const RECENT_LIMIT = 50

/**
 * In-memory human task and freeze state for one plugin instance. Teammates
 * are in-process, so registry lifetime deliberately matches the runtime: a
 * restart dissolves the team and the registries with it.
 */
export class TeamOps {
  private readonly tasks = new Map<string, HumanTask>()
  private readonly order: string[] = []
  private readonly waiters = new Set<TaskWaiter>()
  /** agentId -> open blocking human task id. */
  private readonly paused = new Map<string, string>()
  /** agentId -> freeze record. */
  private readonly frozen = new Map<string, FreezeRecord>()
  private readonly auditPath: string

  constructor(auditPath: string = join(process.cwd(), '.dsh-human-tasks.jsonl')) {
    this.auditPath = auditPath
  }

  /** Append one citable audit line; IO failures never break the tool flow. */
  audit(event: string, fields: Readonly<Record<string, unknown>>): void {
    try {
      appendFileSync(this.auditPath, `${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`)
    } catch {
      /* audit is best-effort provenance, not a gate */
    }
  }

  /**
   * Queue one human-gated step and park the affected lane.
   * @param teamId - Team identity for grouping.
   * @param memberId - member whose lane this task is for (wake messages address it).
   * @param memberName - model-facing member name for wake messages.
   * @param input - task content.
   * @param options - parking selection; defaults to parking the calling member.
   * @returns the queued task.
   * @throws when the parked member already waits on an open task.
   */
  create(
    teamId: string,
    memberId: string,
    memberName: string,
    input: HumanTaskInput,
    options?: CreateOptions,
  ): HumanTask {
    const parkMemberId = options?.parkMemberId !== undefined ? options.parkMemberId : memberId
    const existing = parkMemberId === null ? undefined : this.pausedTaskOf(parkMemberId)
    if (existing !== undefined) {
      throw new Error(
        `agent "${memberName}" already waits on human task ${existing.id} ("${existing.title}"); resolve it first`,
      )
    }
    const task: HumanTask = {
      id: input.id ?? newHumanTaskId(),
      teamId,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
      title: input.title,
      steps: [...input.steps],
      doneWhen: input.doneWhen,
      memberName,
      memberId,
      ...(input.preserveTab === undefined ? {} : { preserveTab: input.preserveTab }),
      ...(input.preserveUrl === undefined ? {} : { preserveUrl: input.preserveUrl }),
      ...(input.dedupeKey === undefined || input.dedupeKey === '' ? {} : { dedupeKey: input.dedupeKey }),
      createdAt: new Date().toISOString(),
    }
    this.tasks.set(task.id, task)
    this.order.push(task.id)
    if (parkMemberId !== null) this.paused.set(parkMemberId, task.id)
    this.audit('human_task_created', {
      task_id: task.id,
      team_id: teamId,
      lane: task.lane,
      member: memberName,
      title: task.title,
      ...(task.dedupeKey === undefined ? {} : { dedupe_key: task.dedupeKey }),
    })
    return task
  }

  /**
   * Idempotency lookup (run-7 P1-5): the open task carrying this dedupe key,
   * when it was created within the dedupe window. Same key within the window
   * returns the existing task instead of raising a second near-identical wall.
   */
  openTaskByDedupeKey(teamId: string, dedupeKey: string, windowMs: number = DEDUPE_WINDOW_MS): HumanTask | undefined {
    if (dedupeKey === '') return undefined
    const cutoff = Date.now() - windowMs
    for (let at = this.order.length - 1; at >= 0; at--) {
      const task = this.tasks.get(this.order[at]!)
      if (task === undefined) continue
      if (task.resolvedAt !== undefined) continue
      if (task.dedupeKey !== dedupeKey || task.teamId !== teamId) continue
      if (Date.parse(task.createdAt) < cutoff) continue
      return task
    }
    return undefined
  }

  /**
   * Edit an open wall's title/steps/done_when (run-7 P1-5). Returns the
   * edited task; the caller refreshes the board-mirror description.
   * @throws for unknown or already-resolved tasks.
   */
  edit(taskId: string, edit: HumanTaskEdit): HumanTask {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new Error(`human task ${taskId} not found`)
    if (task.resolvedAt !== undefined) throw new Error(`human task ${taskId} was already resolved as ${task.outcome}; raise a new one`)
    if (edit.title !== undefined) task.title = edit.title
    if (edit.steps !== undefined) task.steps = [...edit.steps]
    if (edit.doneWhen !== undefined) task.doneWhen = edit.doneWhen
    this.audit('human_task_updated', { task_id: taskId, fields: Object.keys(edit).join(',') })
    return task
  }

  /** Attach the shared-board mirror identity after the board task exists. */
  attachBoardTask(taskId: string, boardTaskId: string, revision: number): void {
    const task = this.tasks.get(taskId)
    if (task === undefined) return
    task.boardTaskId = boardTaskId
    task.boardRevision = revision
  }

  /** One queued task by id, including resolved ones. */
  get(taskId: string): HumanTask | undefined {
    return this.tasks.get(taskId)
  }

  /** Newest-first queue slice, resolved tasks included for follow-up context. */
  list(): HumanTask[] {
    return [...this.order].reverse().slice(0, RECENT_LIMIT)
      .map(id => this.tasks.get(id))
      .filter((task): task is HumanTask => task !== undefined)
  }

  /** The open blocking task parking one agent, if any. */
  pausedTaskOf(agentId: string): HumanTask | undefined {
    const taskId = this.paused.get(agentId)
    if (taskId === undefined) return undefined
    const task = this.tasks.get(taskId)
    return task !== undefined && task.resolvedAt === undefined ? task : undefined
  }

  /**
   * Resolve one task, release the parked agent, and wake local waiters.
   * @returns the resolved task.
   * @throws for unknown or already-resolved tasks.
   */
  resolve(taskId: string, outcome: HumanTaskOutcome, resolvedBy: string, summary?: string): HumanTask {
    const task = this.tasks.get(taskId)
    if (task === undefined) throw new Error(`human task ${taskId} not found`)
    if (task.resolvedAt !== undefined) throw new Error(`human task ${taskId} was already resolved as ${task.outcome}`)
    task.resolvedAt = new Date().toISOString()
    task.outcome = outcome
    task.resolvedBy = resolvedBy
    if (summary !== undefined) task.summary = summary
    if (this.paused.get(task.memberId) === taskId) this.paused.delete(task.memberId)
    this.audit('human_task_resolved', {
      task_id: taskId,
      team_id: task.teamId,
      lane: task.lane,
      member: task.memberName,
      outcome,
      resolved_by: resolvedBy,
    })
    for (const waiter of [...this.waiters]) {
      if (waiter.taskId === taskId) {
        this.waiters.delete(waiter)
        waiter.notify()
      }
    }
    return task
  }

  /**
   * Block until the task resolves, the timeout fires, or the call aborts.
   * @returns the resolved task, or a timeout marker.
   */
  wait(taskId: string, timeoutMs: number, signal: AbortSignal): Promise<{ task: HumanTask } | { timedOut: true }> {
    const settled = this.tasks.get(taskId)?.resolvedAt !== undefined
    if (settled) {
      const task = this.tasks.get(taskId)
      if (task !== undefined) return Promise.resolve({ task })
    }
    return new Promise(resolve => {
      let done = false
      const waiter: TaskWaiter = {
        taskId,
        notify: () => {
          const task = this.tasks.get(taskId)
          if (task === undefined || task.resolvedAt === undefined) return
          finish({ task })
        },
      }
      const finish = (result: { task: HumanTask } | { timedOut: true }): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.waiters.delete(waiter)
        resolve(result)
      }
      const timer = setTimeout(() => { finish({ timedOut: true }) }, timeoutMs)
      const onAbort = (): void => { finish({ timedOut: true }) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      this.waiters.add(waiter)
    })
  }

  /** Park one teammate's lane (Lead-only at the tool layer). */
  freeze(memberId: string, memberName: string, by: string, note?: string): FreezeRecord {
    const record: FreezeRecord = {
      memberName,
      by,
      ...(note === undefined ? {} : { note }),
      at: new Date().toISOString(),
    }
    this.frozen.set(memberId, record)
    this.audit('lane_frozen', { member: memberName, by, note })
    return record
  }

  /** Release one lane park.
   * @returns the removed record, or undefined when it was not frozen. */
  unfreeze(memberId: string): FreezeRecord | undefined {
    const record = this.frozen.get(memberId)
    if (record === undefined) return undefined
    this.frozen.delete(memberId)
    this.audit('lane_resumed', { member: record.memberName, note: record.note })
    return record
  }

  /** The freeze record parking one agent, if any. */
  freezeOf(agentId: string): FreezeRecord | undefined {
    return this.frozen.get(agentId)
  }

  /** Every current lane park, for snapshots and queue listings. */
  frozenLanes(): FreezeRecord[] {
    return [...this.frozen.values()]
  }

  /**
   * Guard verdict for one tool call by one agent: the denial reason when the
   * agent is parked (human task) or frozen and the tool is not allowed in
   * that state, or undefined when the call may proceed.
   */
  denialFor(agentId: string, tool: string): string | undefined {
    const pause = this.pausedTaskOf(agentId)
    if (pause !== undefined && !PAUSE_ALLOWED_TOOLS.has(tool)) {
      return `waiting for human on task ${pause.id} ("${pause.title}"): do not retry the gated action. `
        + 'Allowed now: human_task_wait, human_task_list, human_task_resolve; otherwise end your turn and wait.'
    }
    const freeze = this.frozen.get(agentId)
    if (freeze !== undefined && !FREEZE_ALLOWED_TOOLS.has(tool)) {
      return `lane frozen by the Team Lead${freeze.note === undefined ? '' : `: ${freeze.note}`}. `
        + 'Allowed now: send_message, team_snapshot, list_agents; otherwise end your turn until lane_resume.'
    }
    return undefined
  }
}
