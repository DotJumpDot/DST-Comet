/** Scoped model-facing tools for the opt-in Agent Teams runtime. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import type { TeamMemberView } from '@deepseek-ai/dsh-experimental-agent-team'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { TeamOps, newHumanTaskId } from './human-tasks.ts'
import type { HumanTask, HumanTaskOutcome } from './human-tasks.ts'

/** Cordis plugin name. */
export const name = 'tool-agent-team'
/** Services required by the Team tool plugin. */
export const inject = ['agents', 'agentTeams', 'tools', 'systemPrompt']

/** Tool routing configuration. */
export interface Config {
  /** Register `interrupt_agent` and its policy guidance. Defaults to true; false leaves the domain API available. */
  readonly interrupt?: boolean
  /** Continuable-subagent provider used for fresh teammates. */
  readonly freshProvider?: string
  /** Continuable-subagent provider used for completed-prefix fork teammates. */
  readonly forkProvider?: string
  /** Workspace file receiving one JSONL audit line per human-task/freeze transition. */
  readonly humanTaskAuditPath?: string
}

/** Loader schema for the opt-in Team tool plugin. */
export const Config: z<Config> = z.object({
  interrupt: z.boolean().default(true),
  freshProvider: z.string().default('spawn'),
  forkProvider: z.string().default('fork'),
  humanTaskAuditPath: z.string(),
})

/** Model-facing collaboration guidance shared by Lead and teammates. */
function teamPolicy(interrupt: boolean): string {
  return `Agent Teams is available in this session

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation returns FS_STALE_VERSION, read the current file, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message${interrupt ? ' and interrupt_agent' : ''}, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A peer message starts with its sender name. A successful send does not mean the recipient has processed it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.

DST-Comet additions: when only a human can advance a page (captcha, login, email code), call human_task_create with exact click-by-click steps and a done_when post-condition — the affected lane's further tool calls are then refused until any member resolves it, and human_task_wait blocks while you wait; after a resolve, re-verify done_when yourself in the preserved tab. The Team Lead can queue a step for a teammate with owner and stay running itself, and can track its own ask with park:false. The Team Lead parks a teammate between tool calls with lane_freeze / lane_resume instead of interrupting mid-call. release_teammate removes a finished or stale teammate, frees its member slot and name for a respawn — repurpose a lane with release + spawn instead of leaving dead members on the cap. team_snapshot returns the roster, per-member task load, and who waits on a human or is frozen in one call — prefer it after every wakeup. spawn_teammate accepts optional provider, model and effort so recon can run on a cheap model, validation on a strong one, and cross-provider consultants (provider+model, e.g. zai + glm-5.3) spawn as durable teammates; a route that fails provisioning surfaces the child session's underlying error in the member diagnostics. Context discipline: check context_status before long phases, and at a natural checkpoint update your state file FIRST, then call session_compact — compaction runs when your turn ends and the next turn starts condensed. A wait_agent that returns user_input or inbox_message ended early because a message reached your own inbox — read the new message before waiting again.`
}

const ACTIVE_WAIT_STATUSES: ReadonlySet<TeamMemberView['status']> = new Set(['running', 'provisioning'])
const NO_ACTIVE_PEER_MESSAGE = 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.'

/**
 * One model-facing roster row. The Lead pseudo-row omits the
 * teammate-only provisioning fields, so only identity, role, status, and
 * diagnostics are required.
 */
const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target: { type: 'string', required: true },
    role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
    status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'failed'] },
    description: { type: 'string' },
    provider: { type: 'string' },
    context: { type: 'string', enum: ['fresh', 'fork'] },
    model: { type: 'string' },
    diagnostics: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Expose the member name as its model-facing target. */
function modelMember(member: TeamMemberView): InferValue<typeof MEMBER_VIEW_SCHEMA> {
  const { id: _id, name, ...details } = member
  return { target: name, ...details }
}

/** waitForChange with a graceful user-abort path: a human pressing Esc during
 *  a wait is a normal steering event, not a tool failure — surface it as a
 *  structured result instead of the raw `wait_agent aborted: { kind: 'user' }`
 *  TeamError the transcript used to show. */
async function waitForChangeGracefully(
  ctx: Context,
  caller: Agent,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<InferValue<typeof WAIT_VALUE_SCHEMA>> {
  try {
    return await ctx.agentTeams.waitForChange(caller, timeoutMs, signal) as InferValue<typeof WAIT_VALUE_SCHEMA>
  } catch (error) {
    const code = (error as { code?: unknown }).code
    const aborted = code === 'TEAM_WAIT_ABORTED'
      || (error instanceof Error && error.message.startsWith('wait_agent aborted'))
    if (!aborted) throw error
    return {
      timedOut: false,
      interrupted: true,
      message: 'wait_agent was interrupted (the user aborted the wait). Re-list with list_agents / team_snapshot before deciding the next step.',
    }
  }
}

/** DST-Comet live-run gap (2026-10-27): a human message typed while the Lead
 *  sat in wait_agent stayed parked as steering until the wait timed out — the
 *  human had to Esc-abort and resend. Race the Team wait against the caller's
 *  own inbox: any message inserted there (human input, or a peer relay that
 *  will also notify activity) is exactly the "something changed" the caller is
 *  waiting for, so the wait returns the moment it lands. Pending steering that
 *  arrived before the listener attached is caught by the inbox pre-check. */
async function waitForChangeOrInbox(
  ctx: Context,
  caller: Agent,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<InferValue<typeof WAIT_VALUE_SCHEMA>> {
  const pendingUser = caller.inbox.nextStep.find(message => message.source.kind === 'user')
  if (pendingUser !== undefined) {
    return {
      timedOut: false,
      user_input: true,
      message: 'user input is already pending in your inbox — read the new user message and steer the plan before waiting again.',
    }
  }
  let disposeInbox: (() => void) | undefined
  const inbox = new Promise<'user' | 'peer'>(resolve => {
    disposeInbox = caller.ctx.on('agent/inbox/inserted', ({ message }) => {
      resolve(message.source.kind === 'user' ? 'user' : 'peer')
    })
  })
  // The losing promise may settle (or reject) after the race is decided; both
  // branches are already observed, so no rejection escapes unhandled.
  void inbox.then(() => undefined, () => undefined)
  const change = waitForChangeGracefully(ctx, caller, timeoutMs, signal)
  void change.then(() => undefined, () => undefined)
  try {
    return await Promise.race([
      change,
      inbox.then(source => source === 'user'
        ? {
          timedOut: false,
          user_input: true,
          message: 'user input arrived while waiting — read the new user message and steer the plan before waiting again.',
        }
        : {
          timedOut: false,
          inbox_message: true,
          message: 'a peer message arrived while waiting — read it, then re-list with team_snapshot before waiting again.',
        }),
    ]) as InferValue<typeof WAIT_VALUE_SCHEMA>
  } finally {
    disposeInbox?.()
  }
}

/** Project one registry human task into its model-facing view. */
function humanTaskView(task: HumanTask): InferValue<typeof HUMAN_TASK_VIEW_SCHEMA> {
  return {
    id: task.id,
    ...task.lane === undefined ? {} : { lane: task.lane },
    title: task.title,
    member: task.memberName,
    status: task.resolvedAt === undefined ? 'waiting' : (task.outcome ?? 'skip'),
    steps: [...task.steps],
    done_when: task.doneWhen,
    ...task.preserveTab === undefined ? {} : { preserve_tab: task.preserveTab },
    ...task.preserveUrl === undefined ? {} : { preserve_url: task.preserveUrl },
    ...task.boardTaskId === undefined ? {} : { board_task_id: task.boardTaskId },
    created_at: task.createdAt,
    ...(task.resolvedAt === undefined
      ? {}
      : {
        resolved_at: task.resolvedAt,
        ...task.resolvedBy === undefined ? {} : { resolved_by: task.resolvedBy },
      }),
    ...task.summary === undefined ? {} : { summary: task.summary },
  }
}

/** One shared task, matching the public `TeamTaskView`. */
const TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    subject: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    ownerName: { type: 'string' },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    writeScopes: { type: 'array', required: true, items: { type: 'string' } },
    ready: { type: 'boolean', required: true },
    writeScopeWarnings: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const SPAWN_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { ...MEMBER_VIEW_SCHEMA, required: true },
  },
} as const

const MEMBER_LIST_VALUE_SCHEMA = { type: 'array', items: MEMBER_VIEW_SCHEMA } as const

const SEND_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sent: { type: 'boolean', required: true, const: true },
  },
} as const

/** Result of removing one teammate from the roster (DST-Comet). */
const RELEASE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    released: { type: 'boolean', required: true, const: true },
    member: { type: 'string', required: true },
    stopped_live_child: { type: 'boolean', required: true },
  },
} as const

/** `noProgress` is present only on the model-only shortcut that skips the wait;
 *  `interrupted` only when the wait ended by a user abort instead of an error;
 *  `user_input` / `inbox_message` when the caller's own inbox woke the wait;
 *  `changed` / `target` / `detail` carry the service's wake reason (what
 *  moved, so the Lead can skip a full re-list when the reason suffices). */
const WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    interrupted: { type: 'boolean' },
    user_input: { type: 'boolean' },
    inbox_message: { type: 'boolean' },
    changed: { type: 'string', enum: ['message', 'status', 'task', 'member'] },
    target: { type: 'string' },
    detail: { type: 'string' },
    message: { type: 'string' },
    noProgress: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: { type: 'string', required: true, const: 'no-active-peer' },
        message: { type: 'string', required: true },
      },
    },
  },
} as const

const INTERRUPT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    previousStatus: { type: 'string', required: true, enum: ['running', 'inactive'] },
  },
} as const

/** One queued human-gated step (DST-Comet). */
const HUMAN_TASK_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    lane: { type: 'string' },
    title: { type: 'string', required: true },
    member: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['waiting', 'done', 'failed', 'skip', 'delegated'] },
    steps: { type: 'array', required: true, items: { type: 'string' } },
    done_when: { type: 'string', required: true },
    preserve_tab: { type: 'string' },
    preserve_url: { type: 'string' },
    board_task_id: { type: 'string' },
    created_at: { type: 'string', required: true },
    resolved_at: { type: 'string' },
    resolved_by: { type: 'string' },
    summary: { type: 'string' },
  },
} as const

const HUMAN_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: HUMAN_TASK_VIEW_SCHEMA },
    frozenLanes: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member: { type: 'string', required: true },
          by: { type: 'string', required: true },
          note: { type: 'string' },
          at: { type: 'string', required: true },
        },
      },
    },
  },
} as const

const HUMAN_CREATE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: { ...HUMAN_TASK_VIEW_SCHEMA, required: true },
    deduplicated: { type: 'boolean', description: 'True when a dedupe_key matched an open task and the EXISTING wall was returned instead of raising a second one.' },
  },
} as const

const HUMAN_UPDATE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: { ...HUMAN_TASK_VIEW_SCHEMA, required: true },
    board_updated: { type: 'boolean', required: true, description: 'Whether the shared-board mirror description was refreshed too.' },
  },
} as const

const HUMAN_RESOLVE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resolved: { type: 'boolean', required: true, const: true },
    notified_member: { type: 'boolean', required: true },
    board_completed: { type: 'boolean', required: true },
  },
} as const

/** `woke` is present when the wait ended by resolution; `timedOut` when it expired. */
const HUMAN_WAIT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    woke: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task_id: { type: 'string', required: true },
        outcome: { type: 'string', required: true, enum: ['done', 'failed', 'skip', 'delegated'] },
      },
    },
    timedOut: { type: 'boolean' },
  },
} as const

const LANE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { type: 'string', required: true },
    state: { type: 'string', required: true, enum: ['frozen', 'resumed'] },
    notified_member: { type: 'boolean', required: true },
  },
} as const

/** One-call orchestration summary (DST-Comet). */
const SNAPSHOT_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    generatedAt: { type: 'string', required: true },
    members: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', required: true },
          role: { type: 'string', required: true, enum: ['lead', 'teammate'] },
          status: { type: 'string', required: true, enum: ['running', 'inactive', 'provisioning', 'failed'] },
          model: { type: 'string' },
          inProgressTasks: { type: 'array', required: true, items: { type: 'string' } },
          pendingTasks: { type: 'integer', required: true },
          waitingOnHuman: { type: 'string' },
          frozen: { type: 'string' },
        },
      },
    },
    openHumanTasks: { type: 'integer', required: true },
    frozenLanes: { type: 'integer', required: true },
  },
} as const

const TASK_LIST_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: { type: 'array', required: true, items: TASK_VIEW_SCHEMA },
    nextCursor: { type: 'integer' },
  },
} as const

/**
 * Declare one canonical output schema with compact model-facing JSON. Every
 * Team result is a fixed record, so the declared schema is what makes the
 * compiler check `execute` against the value the model is promised.
 * @param schema - canonical value schema for one tool.
 * @returns the `output` declaration accepted by {@link defineTool}.
 */
function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args: unknown, value: InferValue<S>) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/** Recover the exact caller guaranteed by Agent-scoped tool discovery. */
function callingAgent(agent: Agent | undefined, toolName: string): Agent {
  /* v8 ignore next 2 -- Team tools are registered only in an exact Agent scope, so discovery supplies this carrier. */
  if (agent === undefined) throw new Error(`${toolName} requires a calling Agent`)
  return agent
}

/** Register the complete Team tool set in one exact Agent scope. */
function install(agent: Agent, ctx: Context, config: Required<Config>, ops: TeamOps): () => void {
  const scoped = agent.ctx
  const disposers: Array<() => unknown> = []
  const register = (disposer: () => unknown): void => { disposers.push(disposer) }
  try {
    register(scoped.systemPrompt.section({
      name: 'team:policy',
      order: scoped.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: teamPolicy(config.interrupt),
    }))
    register(scoped.systemPrompt.context({
      name: 'team:identity',
      order: scoped.systemPrompt.getContextOrder('TEAM_IDENTITY'),
      required: true,
      text: () => {
        const { role, name } = ctx.agentTeams.membership(agent)
        return `${role === 'lead'
          ? 'You are the Team Lead named "lead".'
          : `You are teammate "${name}".\nYour Team Lead is named "lead".\nTo message your Team Lead, use send_message({ target: "lead", message: "..." }).`}
Use list_agents({}) to find your teammates and their names.
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).`
      },
    }))

    register(scoped.tools.register(defineTool({
      name: 'spawn_teammate',
      description: 'Create one named, durable teammate. Only the Team Lead may call this tool.',
      parameters: {
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case teammate name.' },
        description: { type: 'string', required: true, description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', required: true, description: 'Complete initial task for the teammate.' },
        context: {
          type: 'string',
          enum: ['fresh', 'fork'],
          description: 'fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.',
        },
        model: {
          type: 'string',
          description: 'Optional per-teammate model id (cheap model for recon, strong one for validation). Unsupported routes fail provisioning with the child session error in the diagnostics.',
        },
        provider: {
          type: 'string',
          description: 'Optional LLM provider route for this teammate — cross-provider consultants (e.g. "zai" for glm-5.3). Must have a registered adapter at call time; an unknown route fails at the teammate\'s first model call and surfaces that error. Defaults to the session provider.',
        },
        effort: {
          type: 'string',
          description: 'Optional reasoning-effort id for the teammate (provider-interpreted).',
        },
      },
      output: jsonOutput(SPAWN_VALUE_SCHEMA),
      async execute(args, exec) {
        const agent = callingAgent(exec.agent, 'spawn_teammate')
        const context = args.context ?? 'fresh'
        const routeOptions = {
          ...args.provider === undefined ? {} : { provider: args.provider },
          ...args.model === undefined ? {} : { model: args.model },
          ...args.effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(args.effort) },
        }
        const agentOptions = Object.keys(routeOptions).length === 0 ? undefined : routeOptions
        const result = await ctx.agentTeams.spawnTeammate(agent, {
          name: args.name,
          description: args.description,
          prompt: [{ type: 'text', text: args.prompt }],
          context,
          provider: context === 'fork' ? config.forkProvider : config.freshProvider,
          ...(agentOptions === undefined ? {} : { agentOptions }),
          signal: exec.signal,
        })
        return { member: modelMember(result.member) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'release_teammate',
      description: 'Remove one finished or stale teammate from the roster and stop its live session: frees its member slot and its name for a respawn. Repurpose a lane by release + spawn instead of leaving dead members on the cap. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate target from spawn_teammate or list_agents.' },
      },
      output: jsonOutput(RELEASE_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'release_teammate')
        const result = await ctx.agentTeams.releaseTeammate(caller, {
          target: args.target,
          signal: exec.signal,
        })
        return { released: true as const, member: result.name, stopped_live_child: result.stoppedLiveChild }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'send_message',
      description: 'Send one message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn.',
      parameters: {
        target: { type: 'string', required: true, description: 'Member target returned by spawn_teammate or list_agents, including lead.' },
        message: { type: 'string', required: true, description: 'Self-contained message for the target.' },
      },
      output: jsonOutput(SEND_VALUE_SCHEMA),
      async execute(args, exec) {
        await ctx.agentTeams.sendMessage(callingAgent(exec.agent, 'send_message'), {
          target: args.target,
          content: [{ type: 'text', text: args.message }],
          signal: exec.signal,
        })
        return { sent: true }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'list_agents',
      description: 'List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. provisioning and failed describe member creation.',
      parameters: {},
      output: jsonOutput(MEMBER_LIST_VALUE_SCHEMA),
      execute(_args, exec) {
        return Promise.resolve(ctx.agentTeams.listMembers(callingAgent(exec.agent, 'list_agents')).map(modelMember))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'wait_agent',
      description: 'Wait for the next teammate status, message, or shared-task change after this call starts. The result says WHAT woke it (changed: message|status|task|member with target and detail) so you can often skip the full re-list. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.',
      parameters: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
      output: jsonOutput(WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'wait_agent')
        const timeoutMs = args.timeout_ms ?? 30_000
        // Preserve TeamService's authoritative timeout validation before the
        // model-only no-progress shortcut.
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
          return await waitForChangeGracefully(ctx, caller, timeoutMs, exec.signal)
        }
        // The active-peer read and waiter registration must remain one synchronous
        // span; awaiting between them can lose the only peer-status edge.
        const hasActivePeer = ctx.agentTeams.listMembers(caller).some(member =>
          member.id !== caller.id && ACTIVE_WAIT_STATUSES.has(member.status))
        if (!hasActivePeer) {
          return {
            timedOut: false,
            noProgress: {
              reason: 'no-active-peer' as const,
              message: NO_ACTIVE_PEER_MESSAGE,
            },
          }
        }
        return await waitForChangeOrInbox(ctx, caller, timeoutMs, exec.signal)
      },
    })))

    if (config.interrupt) {
      register(scoped.tools.register(defineTool({
        name: 'interrupt_agent',
        description: 'Interrupt one teammate\'s current turn while preserving its pending inbox. Team Lead only.',
        parameters: {
          target: { type: 'string', required: true, description: 'Teammate target returned by spawn_teammate or list_agents.' },
        },
        output: jsonOutput(INTERRUPT_VALUE_SCHEMA),
        execute(args, exec) {
          return Promise.resolve(ctx.agentTeams.interrupt(callingAgent(exec.agent, 'interrupt_agent'), args.target))
        },
      })))
    }

    register(scoped.tools.register(defineTool({
      name: 'team_task_create',
      description: 'Create one unowned pending task on the shared Team task board.',
      parameters: {
        subject: { type: 'string', required: true, description: 'Concise task title.' },
        description: { type: 'string', required: true, description: 'Complete task details and acceptance criteria.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
        write_scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory workspace-relative file or directory prefixes this task expects to modify.',
        },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.createTask(callingAgent(exec.agent, 'team_task_create'), {
          subject: args.subject,
          description: args.description,
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_list',
      description: 'List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
      parameters: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed'],
          description: 'Optional exact status filter.',
        },
        owner: { type: 'string', description: 'Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner.' },
        ready: { type: 'boolean', description: 'Optional readiness filter.' },
        cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
        limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
      },
      output: jsonOutput(TASK_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        const status = args.status
        const filtered = ctx.agentTeams.listTasks(callingAgent(exec.agent, 'team_task_list')).filter(task =>
          (status === undefined || task.status === status)
          && (args.owner === undefined || (args.owner === 'unowned' ? task.ownerName === undefined : task.ownerName === args.owner))
          && (args.ready === undefined || task.ready === args.ready))
        const cursor = args.cursor ?? 0
        const limit = args.limit ?? 50
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative safe integer')
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 through 100')
        return Promise.resolve({
          tasks: filtered.slice(cursor, cursor + limit),
          ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
        })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_get',
      description: 'Read the complete latest value of one shared task before changing or executing it.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return Promise.resolve(ctx.agentTeams.getTask(
          callingAgent(exec.agent, 'team_task_get'),
          TeamTaskId(args.task_id),
        ))
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'team_task_update',
      description: 'Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Shared task id.' },
        expected_revision: { type: 'integer', required: true, description: 'Current task revision used as the CAS precondition.' },
        action: {
          type: 'string',
          required: true,
          enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'],
          description: 'Task transition to apply.',
        },
        subject: { type: 'string', description: 'Replacement title for edit.' },
        description: { type: 'string', description: 'Replacement details for edit.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
        write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
        owner: { type: 'string', description: 'Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign.' },
      },
      output: jsonOutput(TASK_VIEW_SCHEMA),
      async execute(args, exec) {
        return await ctx.agentTeams.updateTask(callingAgent(exec.agent, 'team_task_update'), {
          taskId: TeamTaskId(args.task_id),
          expectedRevision: args.expected_revision,
          action: args.action,
          ...args.subject === undefined ? {} : { subject: args.subject },
          ...args.description === undefined ? {} : { description: args.description },
          ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by.map(TeamTaskId) },
          ...args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes },
          ...args.owner === undefined ? {} : { owner: args.owner },
        })
      },
    })))

    // ── DST-Comet additions ────────────────────────────────────────────────

    register(scoped.tools.register(defineTool({
      name: 'team_snapshot',
      description: 'One-call orchestration summary: per member status, in-progress and pending task load, who waits on a human task, and which lanes the Lead froze. Prefer this over list_agents + team_task_list after every wakeup.',
      parameters: {},
      output: jsonOutput(SNAPSHOT_VALUE_SCHEMA),
      execute(_args, exec) {
        const caller = callingAgent(exec.agent, 'team_snapshot')
        const members = ctx.agentTeams.listMembers(caller)
        const tasks = ctx.agentTeams.listTasks(caller)
        const value: InferValue<typeof SNAPSHOT_VALUE_SCHEMA> = {
          generatedAt: new Date().toISOString(),
          members: members.map(member => {
            const owned = tasks.filter(task => task.ownerName === member.name)
            const pause = ops.pausedTaskOf(member.id)
            const freeze = ops.freezeOf(member.id)
            return {
              target: member.name,
              role: member.role,
              status: member.status,
              ...member.model === undefined ? {} : { model: member.model },
              inProgressTasks: owned.filter(task => task.status === 'in_progress').map(task => task.id),
              pendingTasks: owned.filter(task => task.status === 'pending').length,
              ...pause === undefined ? {} : { waitingOnHuman: pause.id },
              ...freeze === undefined ? {} : { frozen: freeze.note ?? 'parked by the Team Lead' },
            }
          }),
          openHumanTasks: ops.list().filter(task => task.resolvedAt === undefined).length,
          frozenLanes: ops.frozenLanes().length,
        }
        return Promise.resolve(value)
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'human_task_create',
      description: 'Queue a human-gated step (captcha, login, email code) and park the affected lane: that member\'s further tool calls are refused until any member resolves it. The tab and page state are untouched; a mirrored shared task keeps the queue visible on the board. Parking defaults are role-aware (run-7): a TEAMMATE parks itself; the LEAD does NOT park itself unless it passes park:true — the coordinator must keep its tools while lanes run. Pass owner:<teammate> to queue a step for a lane.',
      parameters: {
        title: { type: 'string', required: true, description: 'Short imperative title, e.g. "solve the Bugcrowd login captcha".' },
        steps: { type: 'array', required: true, items: { type: 'string' }, description: 'Exact click-by-click steps for the human.' },
        done_when: { type: 'string', required: true, description: 'Post-condition the agent re-verifies itself after the human finishes.' },
        lane: { type: 'string', description: 'Lane or engagement name for the queue badge.' },
        preserve_tab: { type: 'string', description: 'Tab identifier the human must act in.' },
        preserve_url: { type: 'string', description: 'URL the human must act on.' },
        park: { type: 'boolean', description: 'Override the parking default. Default: teammates park themselves; the Lead does not park itself.' },
        owner: { type: 'string', description: 'Member name whose lane this task parks — lets the Team Lead queue a step for a teammate. Defaults to the caller.' },
        dedupe_key: { type: 'string', description: 'Idempotency key: when an OPEN task with the same key exists (within 15 minutes) it is returned as-is — the Lead and the lane raising the same wall seconds apart must not produce two asks for the human.' },
      },
      output: jsonOutput(HUMAN_CREATE_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'human_task_create')
        const membership = ctx.agentTeams.membership(caller)
        // Resolve the lane this task parks: the caller by default, or another
        // member the Lead queues for.
        let parkedId = caller.id
        let parkedName = membership.name
        let parkedIsTeammate = membership.role === 'teammate'
        if (args.owner !== undefined && args.owner !== 'lead' && args.owner !== membership.name) {
          const target = ctx.agentTeams.listMembers(caller)
            .find(member => member.name === args.owner && member.role === 'teammate')
          if (target === undefined) throw new Error(`teammate "${args.owner}" not found`)
          if (membership.role !== 'lead') throw new Error('only the Team Lead can queue a human task for another member')
          parkedId = target.id
          parkedName = target.name
          parkedIsTeammate = true
        }
        if (ops.freezeOf(caller.id) !== undefined) {
          throw new Error('lane is frozen by the Team Lead; message the Lead instead of queueing a human task')
        }
        if (ops.freezeOf(parkedId) !== undefined) {
          throw new Error(`lane "${parkedName}" is frozen; lane_resume it before queueing a human task for it`)
        }
        // Idempotency (run-7 P1-5): same dedupe_key + open task within the
        // window returns the existing wall — the Lead and the lane raising the
        // same ask 19 s apart must not show the human two walls.
        if (typeof args.dedupe_key === 'string' && args.dedupe_key !== '') {
          const existing = ops.openTaskByDedupeKey(membership.id, args.dedupe_key)
          if (existing !== undefined) {
            return { task: humanTaskView(existing), deduplicated: true }
          }
        }
        // Parking default is role-aware (run-7 P1-5): a teammate parks itself;
        // the Lead does NOT park itself — the coordinator lost its tools while
        // the lane kept running. An explicit park overrides; an owner: lane
        // always parks that lane.
        const parksTeammateLane = parkedId !== caller.id
        const park = args.park === undefined
          ? (parksTeammateLane || membership.role === 'teammate')
          : args.park === true
        // Generate the id here so the board-mirror description can embed it in
        // a machine-readable footer the TUI human-wall panel parses.
        const taskId = newHumanTaskId()
        const meta = {
          id: taskId,
          lane: args.lane ?? parkedName,
          member: parkedName,
          ...args.preserve_tab === undefined ? {} : { preserve_tab: args.preserve_tab },
          ...args.preserve_url === undefined ? {} : { preserve_url: args.preserve_url },
          ...park ? {} : { park: false },
        }
        // Board mirror first so the queue is visible in the TUI task board from
        // the moment the lane parks.
        const boardTask = await ctx.agentTeams.createTask(caller, {
          subject: `[human] ${args.title}`,
          description: `${args.steps.map((step, at) => `${at + 1}. ${step}`).join('\n')}\n\nDone when: ${args.done_when}\n\nhuman-meta: ${JSON.stringify(meta)}`,
        })
        const claimed = await ctx.agentTeams.updateTask(caller, {
          taskId: boardTask.id,
          expectedRevision: boardTask.revision,
          action: 'claim',
        })
        let boardRevision = claimed.revision
        if (parkedIsTeammate && parkedName !== membership.name) {
          // The Lead queued for a lane: attribute the mirror to that lane so
          // the board reads "waiting on lane X", not "the Lead is doing this".
          const reassigned = await ctx.agentTeams.updateTask(caller, {
            taskId: boardTask.id,
            expectedRevision: claimed.revision,
            action: 'reassign',
            owner: parkedName,
          })
          boardRevision = reassigned.revision
        }
        const task = ops.create(membership.id, parkedId, parkedName, {
          id: taskId,
          ...(args.lane === undefined ? {} : { lane: args.lane }),
          title: args.title,
          steps: args.steps,
          doneWhen: args.done_when,
          ...(args.preserve_tab === undefined ? {} : { preserveTab: args.preserve_tab }),
          ...(args.preserve_url === undefined ? {} : { preserveUrl: args.preserve_url }),
          ...(typeof args.dedupe_key === 'string' && args.dedupe_key !== '' ? { dedupeKey: args.dedupe_key } : {}),
        }, { parkMemberId: park ? parkedId : null })
        ops.attachBoardTask(task.id, boardTask.id, boardRevision)
        // Wake the Mother explicitly (DST-Comet live-run gap): the board
        // mirror only wakes Lead-side waiters that were ALREADY waiting when
        // the task appeared — a Lead that calls wait_agent afterwards sleeps
        // until timeout while a lane sits parked on the human. A direct
        // message is both a wait_agent change event and a durable inbox row
        // the Lead sees on the next list/snapshot.
        if (membership.role !== 'lead') {
          await ctx.agentTeams.sendMessage(caller, {
            target: 'lead',
            content: [{
              type: 'text',
              text: `human wall: ${args.title} (task ${task.id}, lane ${args.lane ?? membership.name}) — my tool calls are parked until it is resolved; the queue is in human_task_list / the Agents panel (task section, Doing tab).`,
            }],
            signal: exec.signal,
          })
        }
        return { task: humanTaskView(task) }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'human_task_list',
      description: 'List the human task queue (waiting plus recently resolved) and the current lane freezes.',
      parameters: {
        waiting_only: { type: 'boolean', description: 'Only unresolved tasks. Defaults to false.' },
      },
      output: jsonOutput(HUMAN_LIST_VALUE_SCHEMA),
      execute(args, exec) {
        callingAgent(exec.agent, 'human_task_list')
        const all = ops.list()
        const tasks = (args.waiting_only === true ? all.filter(task => task.resolvedAt === undefined) : all)
          .map(humanTaskView)
        const frozenLanes = ops.frozenLanes().map(record => ({
          member: record.memberName,
          by: record.by,
          ...record.note === undefined ? {} : { note: record.note },
          at: record.at,
        }))
        return Promise.resolve({ tasks, frozenLanes })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'human_task_update',
      description: 'Edit an OPEN human wall\'s title/steps/done_when in place (run-7 P1-5: a tunnel URL baked into the steps previously forced resolve-as-skip and a re-raise). The board mirror is refreshed with the same edit. Any member may update.',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Human task id from human_task_create or human_task_list.' },
        title: { type: 'string', description: 'New title (optional).' },
        steps: { type: 'array', items: { type: 'string' }, description: 'Replacement steps (optional, replaces the whole list).' },
        done_when: { type: 'string', description: 'New post-condition (optional).' },
      },
      output: jsonOutput(HUMAN_UPDATE_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'human_task_update')
        if (args.title === undefined && args.steps === undefined && args.done_when === undefined) {
          throw new Error('provide at least one of title, steps, done_when')
        }
        const task = ops.edit(args.task_id, {
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.steps === undefined ? {} : { steps: args.steps }),
          ...(args.done_when === undefined ? {} : { doneWhen: args.done_when }),
        })
        // Refresh the board mirror so the TUI human-wall panel shows the new
        // steps, not the stale ones (best-effort: one re-get for a drifted
        // revision; a failed mirror edit never fails the queue edit).
        let board_updated = false
        if (task.boardTaskId !== undefined) {
          try {
            const meta = {
              id: task.id,
              lane: task.lane ?? task.memberName,
              member: task.memberName,
              ...(task.preserveTab === undefined ? {} : { preserve_tab: task.preserveTab }),
              ...(task.preserveUrl === undefined ? {} : { preserve_url: task.preserveUrl }),
            }
            const description = `${task.steps.map((step, at) => `${at + 1}. ${step}`).join('\n')}\n\nDone when: ${task.doneWhen}\n\nhuman-meta: ${JSON.stringify(meta)}`
            let boardTask = await ctx.agentTeams.getTask(caller, TeamTaskId(task.boardTaskId))
            const updated = await ctx.agentTeams.updateTask(caller, {
              taskId: TeamTaskId(task.boardTaskId),
              expectedRevision: boardTask.revision,
              action: 'edit',
              ...(task.title === undefined ? {} : { subject: `[human] ${task.title}` }),
              description,
            })
            task.boardRevision = updated.revision
            board_updated = true
          } catch { /* mirror refresh is best-effort */ }
        }
        ops.audit('human_task_board_refreshed', { task_id: task.id, board_updated })
        return { task: humanTaskView(task), board_updated }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'human_task_resolve',
      description: 'Resolve one human task with the human\'s outcome: releases the parked agent and wakes it with the outcome and the done_when post-condition it must re-verify itself. Any member may resolve. `delegated` = the human handed the DECISION back to the agent (record it as the agent\'s ruling, not the human\'s).',
      parameters: {
        task_id: { type: 'string', required: true, description: 'Human task id from human_task_create or human_task_list.' },
        outcome: { type: 'string', required: true, enum: ['done', 'failed', 'skip', 'delegated'], description: 'What the human reported. delegated = the human told the agent to decide.' },
        summary: { type: 'string', description: 'Optional one-line human note passed to the parked agent.' },
      },
      output: jsonOutput(HUMAN_RESOLVE_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'human_task_resolve')
        const task = ops.resolve(args.task_id, args.outcome as HumanTaskOutcome, ctx.agentTeams.membership(caller).name, args.summary)
        // Complete the shared-board mirror when authorized; the queue itself
        // has already resolved, so the mirror is best-effort with one
        // re-get retry for a drifted revision.
        let boardCompleted = false
        if (task.boardTaskId !== undefined) {
          try {
            await ctx.agentTeams.updateTask(caller, {
              taskId: TeamTaskId(task.boardTaskId),
              expectedRevision: task.boardRevision ?? 1,
              action: 'complete',
            })
            boardCompleted = true
          } catch {
            try {
              const latest = ctx.agentTeams.getTask(caller, TeamTaskId(task.boardTaskId))
              if (latest.status !== 'deleted') {
                await ctx.agentTeams.updateTask(caller, {
                  taskId: latest.id,
                  expectedRevision: latest.revision,
                  action: 'complete',
                })
                boardCompleted = true
              }
            } catch { /* board mirror stays open; owner or Lead can complete it later */ }
          }
        }
        let notified = false
        if (task.memberId !== caller.id) {
          // `delegated` changes the ask: the human did not answer, they handed
          // the ruling back — the parked agent decides AND owns the decision
          // in its record (run 4 advice §8c).
          const wakeText = task.outcome === 'delegated'
            ? `Human task ${task.id} ("${task.title}"): the human DELEGATED the decision to you. Decide and proceed yourself; record in STATE that the ruling was yours, not the human's. Post-condition you own: ${task.doneWhen}`
            : `Human task ${task.id} ("${task.title}") resolved as ${task.outcome}${task.summary === undefined ? '' : `: ${task.summary}`}.\nRe-verify the post-condition yourself: ${task.doneWhen}`
          await ctx.agentTeams.sendMessage(caller, {
            target: task.memberName,
            content: [{
              type: 'text',
              text: wakeText,
            }],
            signal: exec.signal,
          })
          notified = true
        }
        return { resolved: true, notified_member: notified, board_completed: boardCompleted }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'human_task_wait',
      description: 'Block until the human task resolves or the timeout fires. Use while parked instead of idling; on timeout re-wait or end your turn.',
      parameters: {
        task_id: { type: 'string', description: 'Task to wait on; defaults to the calling agent\'s open task.' },
        timeout_ms: { type: 'integer', description: 'Wait duration in milliseconds, 1000 through 3600000. Defaults to 60000.' },
      },
      output: jsonOutput(HUMAN_WAIT_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'human_task_wait')
        const taskId = args.task_id ?? ops.pausedTaskOf(caller.id)?.id
        if (taskId === undefined) {
          throw new Error('no task_id given and the calling agent waits on no open human task')
        }
        const timeoutMs = args.timeout_ms ?? 60_000
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 3_600_000) {
          throw new Error('timeout_ms must be an integer from 1000 through 3600000')
        }
        const result = await ops.wait(taskId, timeoutMs, exec.signal)
        if ('timedOut' in result) return { timedOut: true }
        return { woke: { task_id: result.task.id, outcome: result.task.outcome ?? 'skip' } }
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'lane_freeze',
      description: 'Park one teammate between tool calls: the current call finishes, later calls are refused until lane_resume. Lighter than interrupt_agent, which can cut a call mid-flight. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate target from spawn_teammate or list_agents.' },
        note: { type: 'string', description: 'Why the lane is parked (human step, scope question).' },
      },
      output: jsonOutput(LANE_VALUE_SCHEMA),
      execute(args, exec) {
        const caller = callingAgent(exec.agent, 'lane_freeze')
        const membership = ctx.agentTeams.membership(caller)
        if (membership.role !== 'lead') throw new Error('only the Team Lead can freeze lanes')
        const target = ctx.agentTeams.listMembers(caller)
          .find(member => member.name === args.target && member.role === 'teammate')
        if (target === undefined) throw new Error(`teammate "${args.target}" not found`)
        ops.freeze(target.id, target.name, membership.name, args.note)
        return Promise.resolve({ member: target.name, state: 'frozen' as const, notified_member: false })
      },
    })))

    register(scoped.tools.register(defineTool({
      name: 'lane_resume',
      description: 'Release one frozen lane and wake the teammate with a note. Team Lead only.',
      parameters: {
        target: { type: 'string', required: true, description: 'Teammate target from spawn_teammate or list_agents.' },
        note: { type: 'string', description: 'Resume note delivered to the teammate as a message.' },
      },
      output: jsonOutput(LANE_VALUE_SCHEMA),
      async execute(args, exec) {
        const caller = callingAgent(exec.agent, 'lane_resume')
        const membership = ctx.agentTeams.membership(caller)
        if (membership.role !== 'lead') throw new Error('only the Team Lead can resume lanes')
        const target = ctx.agentTeams.listMembers(caller)
          .find(member => member.name === args.target && member.role === 'teammate')
        if (target === undefined) throw new Error(`teammate "${args.target}" not found`)
        const record = ops.unfreeze(target.id)
        if (record === undefined) throw new Error(`lane "${args.target}" is not frozen`)
        await ctx.agentTeams.sendMessage(caller, {
          target: target.name,
          content: [{
            type: 'text',
            text: `lane resumed by the Team Lead${args.note === undefined ? '' : `: ${args.note}`}`,
          }],
          signal: exec.signal,
        })
        return { member: target.name, state: 'resumed' as const, notified_member: true }
      },
    })))
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) void dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) void dispose()
  }
}

/** Install Team tools in every live or subsequently published Team member scope. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: Required<Config> = {
    interrupt: config.interrupt ?? true,
    freshProvider: config.freshProvider ?? 'spawn',
    forkProvider: config.forkProvider ?? 'fork',
    humanTaskAuditPath: config.humanTaskAuditPath ?? '.dsh-human-tasks.jsonl',
  }
  const ops = new TeamOps(resolved.humanTaskAuditPath)
  // Parked (human task) and frozen members have their gated tool calls
  // refused before dispatch; the in-flight call always finishes because
  // guards run pre-execute only. Non-Team agents pass through untouched.
  ctx.tools.guard(exec => {
    const agent = exec.agent
    if (agent === undefined) return undefined
    if (ctx.agentTeams.tryMembership(agent) === undefined) return undefined
    return ops.denialFor(agent.id, exec.name)
  })
  const installed = new Map<Agent, () => void>()
  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return
    installed.set(agent, install(agent, ctx, resolved, ops))
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => void maybeInstall(agent))
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'tool-team.scopedTools()')
}
