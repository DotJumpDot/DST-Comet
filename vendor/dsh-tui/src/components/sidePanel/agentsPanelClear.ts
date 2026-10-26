/**
 * DST Comet Agents-tab clearing: once a session's work is done, finished
 * agents stop occupying the side panel. The set is display state only —
 * the durable roster, the team and every message stay in the channel; the
 * panel just folds them behind one line and `c` brings them back.
 *
 * A cleared id is hidden only while the agent is settled: a teammate that
 * starts another run shows up again immediately, so clearing can never make
 * live work invisible.
 */

/** Bound the module-level set; agent ids are unique per run. */
const MAX_CLEARED = 256

let scope = ''
let showCleared = false
let cleared: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** useSyncExternalStore contract; the Set identity is stable until a change. */
export function subscribeAgentsCleared(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The ids currently folded away (running agents override this in the view). */
export function getAgentsCleared(): ReadonlySet<string> {
  return cleared
}

/** Whether the user asked to show cleared agents again. */
export function getAgentsClearedVisible(): boolean {
  return showCleared
}

/** Reset the fold when the bound session changes (ids are run-scoped). */
export function scopeAgentsCleared(sessionId: string): void {
  if (sessionId === scope) return
  scope = sessionId
  cleared = new Set()
  showCleared = false
  notify()
}

/** Fold the given agents away; no-op when nothing new. */
export function clearAgents(ids: Iterable<string>): void {
  let next: Set<string> | undefined
  for (const id of ids) {
    if (id === '' || cleared.has(id)) continue
    next ??= new Set(cleared)
    next.add(id)
  }
  if (next === undefined) return
  // Keep insertion order (Set order) and drop the oldest overflow.
  const bounded = [...next].slice(-MAX_CLEARED)
  cleared = new Set(bounded)
  notify()
}

/** Show all cleared agents again and drop the fold. */
export function restoreAgents(): void {
  if (cleared.size === 0 && !showCleared) return
  cleared = new Set()
  showCleared = false
  notify()
}

/** Toggle the "show cleared" view. */
export function toggleAgentsClearedVisible(): void {
  showCleared = !showCleared
  notify()
}
