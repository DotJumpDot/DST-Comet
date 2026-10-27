/** Durable Session-message acceptance checks for teammate provisioning. */

import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

type InboxProjection = Record<'next-turn' | 'next-step', UserMessage[]>

/** Fold the durable inbox suffix into the messages still awaiting a claim. */
function pendingInboxMessages(events: readonly SessionEvent[]): UserMessage[] {
  const inbox: InboxProjection = { 'next-turn': [], 'next-step': [] }
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced') continue
    const pending = inbox[event.data.target]
    pending.splice(event.data.start, event.data.removedCount ?? 0, ...event.data.inserted)
  }
  return [...inbox['next-turn'], ...inbox['next-step']]
}

/**
 * Test whether one message is model-visible or still durably pending.
 * @param events - one Session's non-inherited event suffix.
 * @param predicate - identity check for the accepted message.
 * @returns whether history or the current inbox contains a match.
 */
export function messageAccepted(
  events: readonly SessionEvent[],
  predicate: (message: UserMessage) => boolean,
): boolean {
  return events.some(event => event.type === 'user/message' && predicate(event.data))
    || pendingInboxMessages(events).some(predicate)
}

/** Diagnostics cap: a provider error can quote a whole request body. */
const FAILURE_LIMIT = 300

/**
 * Latest durable turn failure from a Session event suffix, for teammate
 * provisioning diagnostics (run-5 advice §3): "initial prompt was not durably
 * accepted" alone hid whether the route failed on an unknown model, an auth
 * rejection, or a provider limitation — the child Session records the real
 * `turn/end` failure verbatim.
 * @param events - one Session's non-inherited event suffix.
 * @returns `"message (CODE)"` for the newest errored turn, or undefined.
 */
export function latestTurnFailure(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/end') continue
    const reason = event.data.reason
    if (reason.kind !== 'error') continue
    const { message, code } = reason.error
    const line = code === 'UNKNOWN' || code === '' ? message : `${message} (${code})`
    return line.length <= FAILURE_LIMIT ? line : `${line.slice(0, FAILURE_LIMIT)}…`
  }
  return undefined
}
