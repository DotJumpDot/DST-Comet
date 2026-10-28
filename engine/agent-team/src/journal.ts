/** Serialized Team transactions over the exact live Lead Session log. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { TeamEventType, TeamState } from './projection.ts'
import type { TeamMemberReleasedData } from './types.ts'
import type { TeamWakeReason } from './activity.ts'

type AppendTeamEvent = <T extends TeamEventType>(type: T, data: SessionEventMap[T]) => void
type MutableTeamEventType = 'team/member' | 'team/task'

/** What one committed event tells a waiter (DST-Comet wake reasons). */
function commitReasonOf(type: MutableTeamEventType, data: SessionEventMap[MutableTeamEventType]): TeamWakeReason {
  const payload = data as { task?: { id?: unknown; subject?: unknown }; member?: { name?: unknown; phase?: unknown } }
  switch (type) {
    case 'team/task':
      return {
        changed: 'task',
        ...(typeof payload.task?.id === 'string' ? { target: payload.task.id } : {}),
        ...(typeof payload.task?.subject === 'string' ? { detail: payload.task.subject } : {}),
      }
    case 'team/member':
      return {
        changed: 'member',
        ...(typeof payload.member?.name === 'string' ? { target: payload.member.name } : {}),
        ...(typeof payload.member?.phase === 'string' ? { detail: payload.member.phase } : {}),
      }
  }
}

/** Owns per-Lead transaction order and committed Team event publication. */
export class TeamJournal {
  private readonly tails = new Map<SessionId, Promise<void>>()

  /**
   * @param ctx - Team service context with the injected Session and
   *   SessionProjections services (DST-Comet: state is read through the
   *   published `stateOf(session, key)` registry — the vendored pin's
   *   `ProjectionHandle` API predates what was shipped as 0.2.1-rc.3).
   * @param onCommit - synchronous notification after the Team event flush
   *   succeeds, carrying what the commit changed for waiters.
   */
  constructor(
    private readonly ctx: Context,
    private readonly onCommit: (root: Agent, reason: TeamWakeReason) => void,
  ) {}

  /**
   * Read authoritative Team state for one exact live Lead.
   * @param root - exact live Team Lead.
   * @returns current projected state selected by the Lead Team id.
   * @throws when the Team unit is not registered or its state has failed.
   */
  state(root: Agent): TeamState {
    const projection = this.ctx.sessionProjections.stateOf(root.session, 'agentTeam')
    if (projection === undefined) throw new Error('the agentTeam projection unit is not registered')
    if (projection.failure !== undefined) throw new Error(projection.failure)
    return projection
  }

  /**
   * Serialize one Lead's asynchronous mutation operation.
   * @param rootId - Lead Session identity selecting the transaction queue.
   * @param operation - complete read-check-append operation.
   * @returns the operation result.
   */
  async transact<T>(rootId: SessionId, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(rootId) ?? Promise.resolve()
    const run = prior.then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    this.tails.set(rootId, tail)
    try {
      return await run
    } finally {
      if (this.tails.get(rootId) === tail) this.tails.delete(rootId)
    }
  }

  /**
   * Append and checkpoint one root-owned Team event before publication.
   * @param root - exact live Lead whose Session owns the event.
   * @param type - Team event discriminant.
   * @param data - payload correlated with the event type.
   */
  async appendAndFlush<T extends MutableTeamEventType>(
    root: Agent,
    type: T,
    data: SessionEventMap[T],
  ): Promise<void> {
    // Team events never enter the conversation surface. This narrower local
    // capability removes Session.append's conditional surface argument while
    // preserving the event-key/payload correlation.
    const append = root.session.append.bind(root.session) as unknown as AppendTeamEvent
    append(type, data)
    await this.ctx.sessions.flush(root.session)
    this.onCommit(root, commitReasonOf(type, data))
  }

  /**
   * Append and checkpoint one root-owned teammate release as a plugin record.
   * The record carries the envelope `ignorable` marker, so a harness that does
   * not know the type retains and skips it instead of refusing the whole log.
   * @param root - exact live Lead whose Session owns the record.
   * @param data - release payload correlated with the Lead Team.
   */
  async appendReleased(root: Agent, data: TeamMemberReleasedData): Promise<void> {
    appendPluginRecord(root.session, 'plugin:agent-team/member-released', data)
    await this.ctx.sessions.flush(root.session)
    this.onCommit(root, {
      changed: 'member',
      ...(typeof data.memberId === 'string' ? { target: data.memberId } : {}),
      detail: 'released',
    })
  }
}
