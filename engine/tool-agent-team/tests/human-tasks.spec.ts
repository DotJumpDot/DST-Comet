/** DST-Comet TeamOps unit tests: human task parking, guard denials, freeze, audit. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { TeamOps, PAUSE_ALLOWED_TOOLS } from '../src/human-tasks.ts'

function rig(): { ops: TeamOps; auditPath: string } {
  const auditPath = join(mkdtempSync(join(tmpdir(), 'teamops-')), 'audit.jsonl')
  return { ops: new TeamOps(auditPath), auditPath }
}

const TEAM = 'team-1'

test('create queues a task and parks the calling agent', () => {
  const { ops } = rig()
  const task = ops.create(TEAM, 'a1', 'scout', { title: 'solve captcha', steps: ['click box'], doneWhen: 'page shows logged in' })
  assert.equal(task.title, 'solve captcha')
  assert.equal(ops.pausedTaskOf('a1')?.id, task.id)
  assert.equal(ops.pausedTaskOf('other'), undefined)
})

test('an agent cannot queue a second task while parked', () => {
  const { ops } = rig()
  ops.create(TEAM, 'a1', 'scout', { title: 'first', steps: [], doneWhen: 'x' })
  assert.throws(() => ops.create(TEAM, 'a1', 'scout', { title: 'second', steps: [], doneWhen: 'x' }), /already waits/)
})

test('paused agent: gated tools refused, read/lifecycle tools allowed', () => {
  const { ops } = rig()
  const task = ops.create(TEAM, 'a1', 'scout', { title: 'gate', steps: [], doneWhen: 'x' })
  const deny = (tool: string): string | undefined => ops.denialFor('a1', tool)
  assert.ok(deny('pwsh')?.includes(task.id))
  assert.ok(deny('browser_navigate') !== undefined)
  assert.ok(deny('send_message') === undefined)
  for (const tool of PAUSE_ALLOWED_TOOLS) assert.equal(deny(tool), undefined, tool)
  // unparked agents pass everything
  assert.equal(ops.denialFor('a2', 'pwsh'), undefined)
})

test('resolve releases the park, records outcome, writes audit lines', async () => {
  const { ops, auditPath } = rig()
  const task = ops.create(TEAM, 'a1', 'scout', { title: 'gate', steps: [], doneWhen: 'x', lane: 'ynab' })
  assert.ok(existsSync(auditPath))
  assert.ok(readFileSync(auditPath, 'utf8').includes('"event":"human_task_created"'))
  assert.throws(() => ops.resolve('missing', 'done', 'lead'), /not found/)
  const done = ops.resolve(task.id, 'done', 'lead', 'clicked through')
  assert.equal(done.outcome, 'done')
  assert.equal(done.summary, 'clicked through')
  assert.equal(ops.pausedTaskOf('a1'), undefined)
  assert.throws(() => ops.resolve(task.id, 'done', 'lead'), /already resolved/)
  const lines = readFileSync(auditPath, 'utf8').trim().split('\n')
  assert.ok(lines.some(line => line.includes('"event":"human_task_resolved"') && line.includes('"lane":"ynab"')))
})

test('wait wakes on resolve and times out otherwise', async () => {
  const { ops } = rig()
  const task = ops.create(TEAM, 'a1', 'scout', { title: 'gate', steps: [], doneWhen: 'x' })
  const signal = new AbortController().signal
  const pending = ops.wait(task.id, 10_000, signal)
  await new Promise(resolve => setTimeout(resolve, 10))
  ops.resolve(task.id, 'skip', 'human')
  const woke = await pending
  assert.ok('task' in woke && woke.task.outcome === 'skip' && woke.task.resolvedBy === 'human')
  // settled wait resolves immediately
  assert.ok('task' in await ops.wait(task.id, 5_000, signal))
  // timeout path
  const t2 = ops.create(TEAM, 'a2', 'mason', { title: 'gate2', steps: [], doneWhen: 'x' })
  const timed = await ops.wait(t2.id, 30, signal)
  assert.deepEqual(timed, { timedOut: true })
})

test('freeze parks the lane; unfreeze releases; denial matches', () => {
  const { ops } = rig()
  ops.freeze('a1', 'scout', 'lead', 'scope question')
  assert.ok(ops.denialFor('a1', 'pwsh')?.includes('scope question'))
  assert.equal(ops.denialFor('a1', 'send_message'), undefined)
  assert.equal(ops.frozenLanes().length, 1)
  const removed = ops.unfreeze('a1')
  assert.equal(removed?.memberName, 'scout')
  assert.equal(ops.denialFor('a1', 'pwsh'), undefined)
  assert.equal(ops.unfreeze('a1'), undefined)
})

test('audit failures never break the flow', () => {
  const ops = new TeamOps('Z:\\no\\such\\dir\\audit.jsonl')
  const task = ops.create(TEAM, 'a1', 'scout', { title: 'gate', steps: [], doneWhen: 'x' })
  ops.resolve(task.id, 'done', 'lead')
  assert.equal(ops.pausedTaskOf('a1'), undefined)
})
