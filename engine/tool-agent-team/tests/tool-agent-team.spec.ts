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
interface TaskView { id: string; member: string; status: string; board_task_id?: string }

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
  const handlers = new Map<string, Array<() => unknown>>()
  const tasks: Array<Record<string, unknown>> = []
  let nextRevision = 1
  const lead: any = {
    id: 'sess-lead',
    ctx: {
      systemPrompt: {
        section: () => () => undefined,
        context: () => () => undefined,
        getSectionOrder: () => 40,
        getContextOrder: () => 20,
      },
      tools: { register: (definition: any) => { registered.push({ name: definition.name, definition }) } },
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
        task.status = request.action === 'claim' ? 'in_progress' : request.action === 'complete' ? 'completed' : task.status
        return { ...task }
      },
      sendMessage: async () => ({ messageId: 'm1' }),
      spawnTeammate: async () => ({ member: mateView }),
    },
    auditPath: join(mkdtempSync(join(tmpdir(), 'toolteam-')), 'audit.jsonl'),
  }
  return { ctx, lead, registered, guards, tasks }
}

const exec = (agent: unknown): any => ({ agent, signal: new AbortController().signal })

test('apply installs the full tool set including the DST-Comet additions', () => {
  const { ctx, registered, guards } = fakeCtx()
  mod.apply(ctx, { humanTaskAuditPath: ctx.auditPath })
  const names = registered.map(row => row.name)
  for (const expected of [
    'spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'team_task_create', 'team_task_list',
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
