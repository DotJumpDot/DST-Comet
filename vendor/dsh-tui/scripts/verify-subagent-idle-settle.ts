/**
 * Idle-settle regression (Agents-tab follow-up to run-5 advice §2): a row
 * born `running` whose child never emits `subagent/end` — an idle continuable
 * child, or a lane released/drained mid-idle — used to pin the dashboard
 * forever, because registry presence kept the row `running` and the fold only
 * takes settled rows. The store now settles such rows to `unknown` on the
 * registry's authority (agent/status ≠ running, or agent/disposed) and
 * resurrects them when the child runs again. This gate drives the STORE
 * directly; the binding wiring is covered by typecheck.
 *
 * Locks:
 *  - settleIdle: running/starting → unknown, completedAt frozen (duration
 *    stops ticking), stream attempt restored;
 *  - resumeRunning: unknown → running, completedAt cleared (duration ticks
 *    again) — the in-place round trip an idle continuable child takes;
 *  - terminal outcomes are epoch facts: neither settleIdle nor resumeRunning
 *    rewrites a completed/failed/cancelled row;
 *  - a real end edge still lands after an idle settle (unknown accepts
 *    settlement, per finish());
 *  - untracked ids are no-ops.
 *
 * Run: node --import tsx/esm scripts/verify-subagent-idle-settle.ts
 */
import assert from 'node:assert/strict'
import { SubagentActivityStore } from '../src/dsh-adapter/subagents.ts'

const store = new SubagentActivityStore()
const running = (id: string): boolean => store.get(id)?.status === 'running'

// Born live via the start seam (the continuable/workflow child path).
store.onSpawned('child-a', 'zai', { runId: 'run-1' })
store.onSpawned('child-b', 'deepseek', { runId: 'run-2' })
assert.equal(running('child-a'), true)
assert.equal(running('child-b'), true)

// 1. Idle settle: running → unknown, duration frozen.
const before = store.get('child-a')!
const ok = store.settleIdle('child-a', 1_000)
assert.equal(ok, true)
const settled = store.get('child-a')!
assert.equal(settled.status, 'unknown')
assert.equal(settled.completedAt, 1_000, 'completedAt takes the event time so duration stops ticking')
assert.equal(settled.startedAt, before.startedAt)

// 2. Resume: unknown → running, completedAt cleared.
assert.equal(store.resumeRunning('child-a'), true)
const resumed = store.get('child-a')!
assert.equal(resumed.status, 'running')
assert.equal(resumed.completedAt, undefined, 'duration ticks again after resume')

// 3. Terminal rows are epoch facts — neither direction rewrites them.
store.onCompleted('child-b', 'done', 'completed', 2_000)
assert.equal(store.settleIdle('child-b'), false, 'a completed row never re-settles')
assert.equal(store.resumeRunning('child-b'), false, 'a completed row never resurrects on a status event')
assert.equal(store.get('child-b')!.status, 'completed')

// 4. A real end edge still lands AFTER an idle settle.
store.settleIdle('child-a', 3_000)
store.onFailed('child-a', 'provider 401', 3_500)
const failedLate = store.get('child-a')!
assert.equal(failedLate.status, 'failed')
assert.equal(failedLate.error, 'provider 401')

// 5. Untracked ids and settled-from-settled are no-ops.
assert.equal(store.settleIdle('ghost'), false)
assert.equal(store.resumeRunning('ghost'), false)
store.settleIdle('child-a', 4_000)
assert.equal(store.settleIdle('child-a', 5_000), false, 'double settle is a no-op (already unknown → finish owns it)')

console.log('verify-subagent-idle-settle: all checks passed')
