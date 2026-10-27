/**
 * DST-Comet tool-layer integration test: apply() over a fake cordis context
 * installs the Team tools in a Lead scope, the human-task/freeze guard
 * refuses gated calls for parked agents, and the queue mirrors onto the
 * shared task board. The peer services are published rc.3 modules — no
 * engine process is started.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import * as mod from '../src/index.ts'

/** Model-facing view of a queued human task (snake_case, as the tool promises). */
interface TaskView { id: string; member: string; status: string; lane?: string; board_task_id?: string }

/** Minimal TeamMemberView-shaped row for the fake service. */
const leadView = {
  id: 'sess-lead', name: 'lead', role: 'lead' as const, status: 'running' as const, diagnostics: [] as string[],
}
const mateView = {
  id: 'sess-mate', name: 'scout', role: 'teammate' as const, status: 'running' as const, diagnostics: [] as string[],
}

function fakeCtx() {
  const registered: Array<{ name: string; definition: any }> = []
  const guards: Array<(exec: any) => string | undefined> = []
  const handlers = new Map<string, Array<(payload: any) => void>>()
  const tasks: Array<Record<string, unknown>> = []
  let nextRevision = 1
  const lead: any = {
    id: 'sess-lead',
    inbox: { nextStep: [] as Array<{ source: { kind: string } }>, nextTurn: [] },
    ctx: {
      systemPrompt: {
        section: () => () => undefined,
        context: () => () => undefined,
        getSectionOrder: () => 40,
        getContextOrder: () => 20,
      },
      tools: { register: (definition: any) => { registered.push({ name: definition.name, definition }) } },
      on: (event: string, handler: (payload: any) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
        return () => {
          const list = (handlers.get(event) ?? []).filter(candidate => candidate !== handler)
          handlers.set(event, list)
        }
      },
    },
  }
  const ctx: any = {
    agents: { list: () => [lead] },
    on: (event: string, handler: () => unknown) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]) },
    effect: () => undefined,
    tools: { guard: (guard: (exec: any) => string | undefined) => { guards.push(guard) } },
    agentTeams: {
      tryMembership: (agent: any) => agent === lead ? { id: 'sess-lead', root: lead, role: 'lead', name: 'lead' } : undefined,
      membership: (agent: any) => agent === lead
        ? { id: 'sess-lead', root: lead, role: 'lead', name: 'lead' }
        : { id: 'sess-mate', root: lead, role: 'teammate', name: 'scout' },
      listMembers: () => [leadView, mateView],
      listTasks: () => tasks,
      createTask: async (_caller: unknown, request: Record<string, unknown>) => {
        const task = { id: `task-${tasks.length + 1}`, revision: nextRevision++, status: 'pending', ...request }
        tasks.push(task)
        return task
      },
      updateTask: async (_caller: unknown, request: Record<string, any>) => {
        const task = tasks.find(candidate => candidate.id === request.taskId)
        assert.ok(task !== undefined, 'board task exists')
        assert.equal(task.revision, request.expectedRevision, 'CAS revision matches')
        task.revision = nextRevision++
        if (request.action === 'claim') task.status = 'in_progress'
        if (request.action === 'complete') task.status = 'completed'
        if (request.action === 'reassign') task.ownerName = request.owner
        return { ...task }
      },
      sendMessage: async () => ({ messageId: 'm1' }),
      spawnTeammate: async () => ({ member: mateView }),
      releaseTeammate: async () => ({ name: 'scout', stoppedLiveChild: true }),
      waitForChange: async () => ({ timedOut: true }),
    },
    auditPath: join(mkdtempSync(join(tmpdir(), 'toolteam-')), 'audit.jsonl'),
  }
  /** Fire one agent-scoped event on the Lead's context. */
  const emitLead = (event: string, payload: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(payload)
  }
  return { ctx, lead, registered, guards, tasks, emitLead }
}

const exec = (agent: unknown): any => ({ agent, signal: new AbortController().signal })

test('apply installs the full tool set including the DST-Comet additions', () => {
  const { ctx, registered, guards } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const names = registered.map(row => row.name)
  for (const expected of [
    'spawn_teammate', 'release_teammate', 'send_message', 'list_agents', 'wait_agent', 'team_task_create', 'team_task_list',
    'team_task_get', 'team_task_update', 'team_snapshot', 'human_task_create', 'human_task_list',
    'human_task_resolve', 'human_task_wait', 'lane_freeze', 'lane_resume',
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`)
  }
  assert.equal(guards.length, 1, 'one pre-dispatch guard installed')
  const spawn = registered.find(row => row.name === 'spawn_teammate')!.definition
  assert.deepEqual(Object.keys(spawn.parameters?.properties ?? {}), ['name', 'description', 'prompt', 'context', 'model', 'effort'])
})

test('spawn_teammate threads model/effort into agentOptions', async () => {
  const { ctx, lead, registered } = fakeCtx()
  const spawned: Array<Record<string, unknown>> = []
  ctx.agentTeams.spawnTeammate = async (_caller: unknown, request: Record<string, unknown>) => {
    spawned.push(request)
    return { member: mateView }
  }
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const spawn = registered.find(row => row.name === 'spawn_teammate')!.definition
  await spawn.execute({ name: 'scout', description: 'recon', prompt: 'go', model: 'deepseek-lite', effort: 'low' }, exec(lead))
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0]!.agentOptions, { model: 'deepseek-lite', reasoningEffort: 'low' })
  spawned.length = 0
  await spawn.execute({ name: 'scout', description: 'recon', prompt: 'go' }, exec(lead))
  assert.equal(spawned[0]!.agentOptions, undefined)
})

test('human_task_create parks the caller, mirrors the board, guard enforces, resolve wakes', async () => {
  const { ctx, lead, registered, guards, tasks } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const guard = guards[0]!
  const create = registered.find(row => row.name === 'human_task_create')!.definition
  const resolve = registered.find(row => row.name === 'human_task_resolve')!.definition

  const result = await create.execute(
    { title: 'solve the login captcha', steps: ['click the box'], done_when: 'page shows the dashboard' },
    exec(lead),
  )
  const task = result.task as TaskView
  assert.equal(task.member, 'lead')
  assert.equal(task.status, 'waiting')
  // The mirror task exists, claimed by the caller.
  const mirror = tasks[0] as Record<string, any>
  assert.equal(mirror.subject, '[human] solve the login captcha')
  assert.equal(mirror.status, 'in_progress')
  assert.equal(task.board_task_id, mirror.id)

  // Gated call refused, lifecycle call allowed.
  assert.ok(guard({ agent: lead, name: 'pwsh' })?.includes(task.id))
  assert.equal(guard({ agent: lead, name: 'human_task_wait' }), undefined)
  assert.equal(guard({ agent: {}, name: 'pwsh' }), undefined, 'non-Team agents pass')

  // A teammate resolves; the parked lead is woken by send_message.
  let woke = false
  ctx.agentTeams.sendMessage = async () => { woke = true; return { messageId: 'm2' } }
  const mate: any = { id: 'sess-mate' }
  const resolved = await resolve.execute({ task_id: task.id, outcome: 'done', summary: 'clicked' }, exec(mate))
  assert.equal(resolved.resolved, true)
  assert.equal(resolved.board_completed, true)
  assert.equal(woke, true)
  assert.equal(guard({ agent: lead, name: 'pwsh' }), undefined)
})

test('lane_freeze / lane_resume are Lead-only and flip the guard', async () => {
  const { ctx, lead, registered, guards } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const guard = guards[0]!
  const freeze = registered.find(row => row.name === 'lane_freeze')!.definition
  const resume = registered.find(row => row.name === 'lane_resume')!.definition

  await freeze.execute({ target: 'scout', note: 'scope question' }, exec(lead))
  const mate: any = { ...lead, id: 'sess-mate' }
  ctx.agentTeams.tryMembership = (agent: any) => agent === lead || agent === mate
    ? { id: agent === lead ? 'sess-lead' : 'sess-mate', root: lead, role: 'teammate', name: agent === lead ? 'lead' : 'scout' }
    : undefined
  assert.ok(guard({ agent: mate, name: 'browser_navigate' })?.includes('scope question'))
  assert.equal(guard({ agent: mate, name: 'send_message' }), undefined)

  const resumed = await resume.execute({ target: 'scout', note: 'cleared' }, exec(lead))
  assert.equal(resumed.state, 'resumed')
  assert.equal(guard({ agent: mate, name: 'browser_navigate' }), undefined)
})

test('team_snapshot folds roster, task load, and park state into one call', async () => {
  const { ctx, lead, registered } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const create = registered.find(row => row.name === 'human_task_create')!.definition
  const snapshot = registered.find(row => row.name === 'team_snapshot')!.definition
  ctx.agentTeams.listTasks = () => [
    { id: 't1', subject: 'a', status: 'in_progress', ownerName: 'scout' },
    { id: 't2', subject: 'b', status: 'pending', ownerName: 'scout' },
    { id: 't3', subject: 'c', status: 'pending', ownerName: 'lead' },
  ]
  await create.execute({ title: 'captcha', steps: [], done_when: 'x' }, exec(lead))
  const snap = await snapshot.execute({}, exec(lead))
  assert.equal(snap.frozenLanes, 0)
  assert.equal(snap.openHumanTasks, 1)
  const rows = snap.members as Array<Record<string, any>>
  const leadRow = rows.find(row => row.target === 'lead')!
  const mateRow = rows.find(row => row.target === 'scout')!
  assert.equal(leadRow.inProgressTasks.length, 0)
  assert.equal(leadRow.pendingTasks, 1)
  assert.ok(leadRow.waitingOnHuman?.startsWith('ht-'))
  assert.deepEqual(mateRow.inProgressTasks, ['t1'])
  assert.equal(mateRow.pendingTasks, 1)
  assert.equal(mateRow.waitingOnHuman, undefined)
})

test('wait_agent surfaces a user abort as a structured result, not an error', async () => {
  const { ctx, lead, registered } = fakeCtx()
  await mod.apply(ctx)
  const wait = registered.find(row => row.name === 'wait_agent')!.definition
  ctx.agentTeams.waitForChange = async () => {
    throw Object.assign(new Error("wait_agent aborted: { kind: 'user' }"), { code: 'TEAM_WAIT_ABORTED' })
  }
  const result = await wait.execute({}, exec(lead))
  assert.equal(result.timedOut, false)
  assert.equal(result.interrupted, true)
  assert.match(result.message, /interrupted/)

  // non-abort failures still propagate
  ctx.agentTeams.waitForChange = async () => { throw new Error('engine exploded') }
  await assert.rejects(() => wait.execute({}, exec(lead)), /engine exploded/)
})

test('human_task_create by a teammate messages the Lead (Mother wake-up gap)', async () => {
  const { ctx, lead, registered } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const create = registered.find(row => row.name === 'human_task_create')!.definition
  const sent: Array<{ target: string; text: string }> = []
  ctx.agentTeams.sendMessage = async (_caller: unknown, request: any) => {
    sent.push({ target: request.target, text: request.content[0].text })
    return { messageId: 'm1' }
  }
  // The Lead parking itself must not self-notify.
  await create.execute({ title: 'lead wall', steps: ['x'], done_when: 'y' }, exec(lead))
  assert.equal(sent.length, 0, 'the Lead parking itself does not message itself')
  // A teammate hitting the human wall notifies the Lead — both a wait_agent
  // change event and a durable inbox row (live-run gap: the board mirror
  // alone only woke waiters that were already waiting).
  const mate: any = { id: 'sess-mate' }
  const result = await create.execute(
    { title: 'enter the emailed OTP', steps: ['open the email', 'type the code'], done_when: 'logged in', lane: 'klaviyo' },
    exec(mate),
  )
  const task = result.task as TaskView
  assert.equal(task.lane, 'klaviyo')
  assert.equal(sent.length, 1, 'the teammate parks AND the Lead is notified')
  assert.equal(sent[0]!.target, 'lead')
  assert.match(sent[0]!.text, /human wall: enter the emailed OTP/)
  assert.match(sent[0]!.text, /klaviyo/)
})

test('human_task_create embeds a machine-readable footer the TUI panel parses', async () => {
  const { ctx, lead, registered, tasks } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const create = registered.find(row => row.name === 'human_task_create')!.definition
  const result = await create.execute(
    { title: 'solve the captcha', steps: ['click the box'], done_when: 'dashboard', lane: 'flourish', preserve_url: 'https://app.flourish.studio/register' },
    exec(lead),
  )
  const task = result.task as TaskView
  const mirror = tasks[0] as Record<string, any>
  const footer = /human-meta: (\{.*\})/.exec(String(mirror.description))
  assert.ok(footer !== null, 'mirror description carries the human-meta footer')
  const meta = JSON.parse(footer![1]!)
  assert.equal(meta.id, task.id)
  assert.equal(meta.lane, 'flourish')
  assert.equal(meta.member, 'lead')
  assert.equal(meta.preserve_url, 'https://app.flourish.studio/register')
})

test('human_task_create park:false queues without parking the caller', async () => {
  const { ctx, lead, registered, guards } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const guard = guards[0]!
  const create = registered.find(row => row.name === 'human_task_create')!.definition
  const result = await create.execute(
    { title: 'human will verify email later', steps: ['check inbox'], done_when: 'email verified', park: false },
    exec(lead),
  )
  assert.equal((result.task as TaskView).status, 'waiting')
  // The Lead stays running: no gated call is refused.
  assert.equal(guard({ agent: lead, name: 'pwsh' }), undefined)
})

test('human_task_create owner:<teammate> parks that lane, not the Lead', async () => {
  const { ctx, lead, registered, guards, tasks } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const guard = guards[0]!
  const create = registered.find(row => row.name === 'human_task_create')!.definition
  const mate: any = { id: 'sess-mate' }
  ctx.agentTeams.tryMembership = (agent: any) => agent === lead
    ? { id: 'sess-lead', root: lead, role: 'lead', name: 'lead' }
    : { id: 'sess-mate', root: lead, role: 'teammate', name: 'scout' }
  const result = await create.execute(
    { title: 'solve the login captcha', steps: ['click the box'], done_when: 'dashboard', owner: 'scout' },
    exec(lead),
  )
  const task = result.task as TaskView
  assert.equal(task.member, 'scout')
  // The Lead keeps working; the queued lane is parked.
  assert.equal(guard({ agent: lead, name: 'pwsh' }), undefined)
  assert.ok(guard({ agent: mate, name: 'pwsh' })?.includes(task.id))
  // The board mirror is attributed to the lane, not the Lead.
  const mirror = tasks[0] as Record<string, any>
  assert.equal(mirror.ownerName, 'scout')
})

test('release_teammate threads to the service with the target name', async () => {
  const { ctx, lead, registered } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const released: Array<Record<string, unknown>> = []
  ctx.agentTeams.releaseTeammate = async (_caller: unknown, request: Record<string, unknown>) => {
    released.push(request)
    return { name: 'old-lane', stoppedLiveChild: true }
  }
  const release = registered.find(row => row.name === 'release_teammate')!.definition
  const result = await release.execute({ target: 'old-lane' }, exec(lead))
  assert.equal(result.released, true)
  assert.equal(result.member, 'old-lane')
  assert.equal(result.stopped_live_child, true)
  assert.deepEqual(released.map(row => row.target), ['old-lane'])
})

test('wait_agent wakes the moment user input lands in the caller inbox', async () => {
  const { ctx, lead, registered, emitLead } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const wait = registered.find(row => row.name === 'wait_agent')!.definition
  // The Team wait never settles first: the inbox insertion must win the race.
  ctx.agentTeams.waitForChange = () => new Promise(() => undefined)
  const pending = wait.execute({ timeout_ms: 60_000 }, exec(lead))
  await new Promise(resolve => setImmediate(resolve))
  emitLead('agent/inbox/inserted', { agent: lead, message: { source: { kind: 'user' } } })
  const result = await pending
  assert.equal(result.timedOut, false)
  assert.equal(result.user_input, true)
  assert.match(result.message, /user input/)

  // A peer relay wakes the wait too, labeled as a peer message.
  const peerWait = wait.execute({ timeout_ms: 60_000 }, exec(lead))
  await new Promise(resolve => setImmediate(resolve))
  emitLead('agent/inbox/inserted', { agent: lead, message: { source: { kind: 'agent-message' } } })
  const peerResult = await peerWait
  assert.equal(peerResult.timedOut, false)
  assert.equal(peerResult.inbox_message, true)
})

test('wait_agent returns immediately when user steering is already pending', async () => {
  const { ctx, lead, registered } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const wait = registered.find(row => row.name === 'wait_agent')!.definition
  let teamWaitCalls = 0
  ctx.agentTeams.waitForChange = async () => { teamWaitCalls += 1; return { timedOut: true } }
  lead.inbox.nextStep.push({ source: { kind: 'user' } })
  const result = await wait.execute({ timeout_ms: 60_000 }, exec(lead))
  assert.equal(result.user_input, true)
  assert.equal(teamWaitCalls, 0, 'the pending steering is answered without entering the Team wait')
})

test('wait_agent forwards the service wake reason (what moved, not just "changed")', async () => {
  const { ctx, lead, registered } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const wait = registered.find(row => row.name === 'wait_agent')!.definition
  const wakes = [
    { timedOut: false, changed: 'task' as const, target: 'task-3', detail: 'fixture signup matrix' },
    { timedOut: false, changed: 'status' as const, target: 'scout', detail: 'idle' },
    { timedOut: false, changed: 'message' as const, target: 'scout', detail: 'lead' },
    { timedOut: true },
  ]
  ctx.agentTeams.waitForChange = async () => wakes.shift()
  const task = await wait.execute({ timeout_ms: 60_000 }, exec(lead))
  assert.deepEqual([task.changed, task.target, task.detail], ['task', 'task-3', 'fixture signup matrix'])
  const status = await wait.execute({ timeout_ms: 60_000 }, exec(lead))
  assert.deepEqual([status.changed, status.target, status.detail], ['status', 'scout', 'idle'])
  const message = await wait.execute({ timeout_ms: 60_000 }, exec(lead))
  assert.deepEqual([message.changed, message.target, message.detail], ['message', 'scout', 'lead'])
  const timeout = await wait.execute({ timeout_ms: 60_000 }, exec(lead))
  assert.equal(timeout.timedOut, true)
  assert.equal(timeout.changed, undefined)
})
