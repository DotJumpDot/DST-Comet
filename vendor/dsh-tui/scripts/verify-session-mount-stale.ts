/**
 * Gate: the pid-reuse witness on session mounts (2026-10-29 incident).
 *
 * The ledger's liveness check is `process.kill(pid, 0)` — cheap and blind to
 * pid REUSE: a recycled pid keeps a dead holder's record "alive" and blocks a
 * session forever (the incident: "held by pid 22776", a conhost that inherited
 * the number). The recovery installs one-shot evidence (pid -> the CURRENT
 * bearer's start time); a bearer that started AFTER the record's holder did
 * is proof the record is an orphan. These checks pin exactly that predicate,
 * including the two ways a record must still count as alive: the bearer IS
 * the holder (equal start time), and the evidence window being closed.
 */
import { strict as assert } from 'node:assert'
import {
  clearStaleHolderEvidence,
  holderRecordAlive,
  installStaleHolderEvidence,
  pidAlive,
} from '../src/sessionMounts.js'

const owner = (pid: number, startedAt: number) => ({ pid, startedAt, sessionIds: [] as string[] })
// The only pid guaranteed alive in this process is our own; witness cases run
// against it, dead-pid cases against a number nothing bears.
const live = process.pid

// Without evidence installed, the predicate is exactly pidAlive.
clearStaleHolderEvidence()
assert.equal(holderRecordAlive(owner(live, 1_000)), true, 'own live pid with no evidence stays alive')
assert.equal(holderRecordAlive(owner(424242, 1_000)), pidAlive(424242), 'no evidence -> pidAlive only (dead pid fails)')

// Evidence installed: a bearer that started AFTER the record is a recycled pid.
installStaleHolderEvidence(new Map([[live, 2_000]]))
assert.equal(holderRecordAlive(owner(live, 1_000)), false, 'bearer started after the holder record -> orphan')
// Equal start time: the bearer IS the holder (same process), not a reuse.
assert.equal(holderRecordAlive(owner(live, 2_000)), true, 'bearer started with the holder record -> same process')
// A bearer older than the record cannot happen for a REUSED pid; the witness
// must not classify it as reuse.
assert.equal(holderRecordAlive(owner(live, 3_000)), true, 'bearer predating the record is not reuse evidence')

// Evidence about a DIFFERENT pid does not affect this one.
installStaleHolderEvidence(new Map([[424242, 2_000]]))
assert.equal(holderRecordAlive(owner(live, 1_000)), true, 'unrelated pid evidence is ignored')

// Clearing restores the blind predicate.
clearStaleHolderEvidence()
assert.equal(holderRecordAlive(owner(424242, 1_000)), pidAlive(424242), 'cleared evidence -> pidAlive only')

console.log('verify-session-mount-stale: OK')
