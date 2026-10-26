/**
 * DST Comet task-board tab: the Agents-panel task section splits into
 * `Doing` (pending/in-progress/blocked) and `Finished` (completed) instead
 * of one ever-growing list the user could not read or clear. Display state
 * only — the board itself is the channel's task projection and stays
 * untouched. Module-level so the choice survives panel switches; click a
 * tab or press `t` to toggle.
 */

export type TaskBoardTab = 'doing' | 'finished'

let tab: TaskBoardTab = 'doing'
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** useSyncExternalStore contract. */
export function subscribeTaskBoardTab(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getTaskBoardTab(): TaskBoardTab {
  return tab
}

export function setTaskBoardTab(next: TaskBoardTab): void {
  if (next === tab) return
  tab = next
  notify()
}

export function toggleTaskBoardTab(): void {
  tab = tab === 'doing' ? 'finished' : 'doing'
  notify()
}
