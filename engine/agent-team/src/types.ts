/** Public Agent Teams identities, durable records, and service request values. */

import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies the implicit team rooted at one top-level Session. */
export type TeamId = Branded<'TeamId'>

/**
 * Brand one root Session identity as its implicit Team identity.
 * @param id - Root Session identity.
 * @returns the same string branded as a Team identity.
 */
export function TeamId(id: SessionId | string): TeamId {
  return id as TeamId
}

/** Stable identifier for one task in a Team. */
export type TeamTaskId = Branded<'TeamTaskId'>

/**
 * Brand a validated task id.
 * @param id - Team-local task identity.
 * @returns the same string branded as a Team task identity.
 */
export function TeamTaskId(id: string): TeamTaskId {
  return id as TeamTaskId
}

/** Stable identifier for one durable peer message. */
export type TeamMessageId = Branded<'TeamMessageId'>

/**
 * Brand a generated peer-message id.
 * @param id - Durable mailbox message identity.
 * @returns the same string branded as a Team message identity.
 */
export function TeamMessageId(id: string): TeamMessageId {
  return id as TeamMessageId
}

/** Durable teammate lifecycle. */
export type TeamMemberPhase = 'provisioning' | 'active' | 'failed'

/** Whole durable value written on every teammate lifecycle change. */
export interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
}

/** Current runtime-enriched roster row. */
export interface TeamMemberView {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly status: 'running' | 'inactive' | 'provisioning' | 'failed'
  readonly description?: string
  readonly provider?: string
  readonly context?: 'fresh' | 'fork'
  readonly model?: string
  readonly diagnostics: string[]
}

/** Durable task lifecycle. */
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted'

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}

/** Runtime-enriched task view returned to tools and hosts. */
export interface TeamTaskView {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
  readonly ownerName?: string
  readonly ready: boolean
  readonly writeScopeWarnings: string[]
}

/** One durable roster row published through the `agentTeam` Session projection. */
export interface TeamMemberProjection {
  readonly id: SessionId
  readonly name: string
  readonly role: 'lead' | 'teammate'
  /** Durable lifecycle; the Lead row is always `active`. Turn activity comes from Session status. */
  readonly phase: TeamMemberPhase
  readonly error?: string
}

/**
 * Durable Team state published to browser clients through the Lead Session's
 * `agentTeam` projection. `failure` names the first rejected persisted Team
 * record; members and tasks then stay at the last valid state.
 */
export interface TeamProjection {
  readonly members: TeamMemberProjection[]
  readonly tasks: TeamTaskView[]
  readonly failure?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Durable roster and non-deleted task board of the Team rooted at the projected Session. */
    agentTeam: TeamProjection
  }

  interface SessionProjectionStateMap {
    /** Host state behind the `agentTeam` wire view (DST-Comet: the published
     *  registry types key acceptance and `stateOf` off this map). */
    agentTeam: import('./projection.ts').TeamProjectionState
  }
}

/** One peer message recorded by the historical Team mailbox. */
export interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}

/** Source recorded by a target Session for one historical Team mailbox delivery. */
export interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-message': TeamMessageSource
  }
}

/** Team-service deployment limits. */
export interface Config {
  /** Maximum immutable teammate names retained by one Team. */
  readonly maxMembers?: number
  /** Maximum non-deleted tasks retained by one Team. */
  readonly maxTasks?: number
  /** Maximum UTF-8 bytes in one complete sender-framed delivery. */
  readonly maxMessageBytes?: number
  /** Maximum milliseconds for shared operation settlement and for each Team child drain. */
  readonly disposalTimeoutMs?: number
}

/** Input for creating one durable teammate. */
export interface SpawnTeammateRequest {
  readonly name: string
  readonly description: string
  readonly prompt: ContentBlock[]
  readonly context: 'fresh' | 'fork'
  readonly provider: string
  readonly signal: AbortSignal
  /**
   * Optional provider/model/effort/output overrides applied to the spawned
   * child's Agent options (DST-Comet: per-teammate model routing — cheap
   * models for recon, strong ones for validation). The subagent provider
   * merges them over the parent Agent's options; start rejects when the
   * provider lacks the agentOptions capability.
   */
  readonly agentOptions?: Readonly<AgentOptions>
}

/** Result after one teammate reaches a durable active or failed edge. */
export interface SpawnTeammateResult {
  readonly member: TeamMemberView
}

/** Input for releasing one teammate from the durable roster (DST-Comet). */
export interface ReleaseTeammateRequest {
  readonly target: string
  readonly signal: AbortSignal
}

/** Result after one teammate left the roster and its live child was drained. */
export interface ReleaseTeammateResult {
  readonly name: string
  readonly stoppedLiveChild: boolean
}

/** Input for one direct peer-message attempt. */
export interface SendTeamMessageRequest {
  readonly target: string
  readonly content: ContentBlock[]
  readonly signal: AbortSignal
}

/** Target inbox acceptance under ordinary Agent persistence; no Team retry or deduplication. */
export interface SendTeamMessageResult {
  readonly messageId: MessageId
}

/** Input for creating one shared task. */
export interface CreateTeamTaskRequest {
  readonly subject: string
  readonly description: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
}

/** Supported task mutation actions. */
export type TeamTaskAction =
  | 'claim'
  | 'release'
  | 'edit'
  | 'set_dependencies'
  | 'complete'
  | 'reopen'
  | 'reassign'
  | 'delete'

/** Compare-and-set mutation of one shared task. */
export interface UpdateTeamTaskRequest {
  readonly taskId: TeamTaskId
  readonly expectedRevision: number
  readonly action: TeamTaskAction
  readonly subject?: string
  readonly description?: string
  readonly blockedBy?: readonly TeamTaskId[]
  readonly writeScopes?: readonly string[]
  readonly owner?: string
}

/** Why one wait woke: the domain that changed. (DST-Comet) */
export type TeamWakeCause = 'message' | 'status' | 'task' | 'member'

/** Result of waiting for Team activity. */
export interface TeamWaitResult {
  readonly timedOut: boolean
  /** What changed to wake the wait; absent on timeout and on race wakes that
   *  carry no reason. Lets the Lead skip the re-list when the reason already
   *  says what moved. (DST-Comet) */
  readonly changed?: TeamWakeCause
  /** Who/what the change concerns: member or target name, or a task id. */
  readonly target?: string
  /** One-line detail: task subject, phase transition, or message sender. */
  readonly detail?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole teammate lifecycle value, stored only in the Team Lead Session. */
    'team/member': { version: 2; teamId: TeamId; member: TeamMemberSnapshot }
    /**
     * Durable teammate removal (DST-Comet: release_teammate). Drops the member
     * from the projected roster, freeing its member slot and its name for a
     * later respawn; stored only in the Team Lead Session.
     */
    'team/member/released': { version: 2; teamId: TeamId; memberId: SessionId }
    /** Whole shared-task value, stored only in the Team Lead Session. */
    'team/task': { version: 2; teamId: TeamId; task: TeamTaskSnapshot }
    /** Historical mailbox enqueue; new sends use the target Agent inbox. */
    'team/message/queued': { version: 2; teamId: TeamId; message: TeamMessageSnapshot }
    /** Historical acknowledgement that the target Session recorded a queued message. */
    'team/message/delivered': {
      version: 2
      teamId: TeamId
      messageId: TeamMessageId
      targetId: SessionId
    }
  }
}
