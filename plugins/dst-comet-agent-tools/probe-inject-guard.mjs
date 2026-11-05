/**
 * Probe for the run-7 P0-4 failure shape: a cordis context whose property
 * access THROWS "cannot get property X without inject" unless X is declared
 * in that context's inject list, while ctx.get(X) resolves without inject —
 * exactly the semantics of @deepseek-ai/cordis 4.0.5's reflect.ts.
 *
 * The previous plugin builds read `serviceCtx.tokenMeter` /
 * `serviceCtx.compaction` and died on the guard. This probe drives both tool
 * executes through a guarded agent ctx: they must succeed via get().
 */
import assert from 'node:assert/strict'
import { apply } from './index.js'

/** A ctx that mimics cordis property access: inject-guarded props, free get(). */
function guardedCtx(services, inject = []) {
  const handler = {
    get(target, prop, receiver) {
      if (prop === 'get') return (name, _strict = true) => services[name]
      if (prop in target) return Reflect.get(target, prop, receiver)
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
    has(target, prop) {
      // Cordis allows property access only for injected names; keep the trap
      // honest so a regression to property syntax fails the same way.
      return inject.includes(prop)
    },
  }
  const base = {
    on: () => () => undefined,
    effect: (gen) => { const it = gen(); const step = (r) => r.done ? undefined : Promise.resolve(it.next(r.value ?? undefined)).then(step); return step(undefined) },
  }
  for (const name of inject) {
    if (name in services) base[name] = services[name]
  }
  return new Proxy(base, handler)
}

const measurements = []
const compactions = []
// Jora post-mortem: the goals service mock behind goal_set / goal_clear.
let goalView
const goalOps = []
// Run-9 §1 reality check: the installed host (dsh 0.2.1-rc.2) ships a
// TokenMeter with measure() but NO contextPressure() method — the pressure
// state is read from the meter's registered 'contextPressure' session
// projection instead. The DEFAULT fixture mirrors that host; the probe would
// have caught the run-9 breakage only if the fake lacked the method.
const pressureStates = new Map()
const services = {
  tokenMeter: {
    measure: (session) => { measurements.push(session); return { totalTokens: 73_000, baseline: { kind: 'estimate' } } },
  },
  sessionProjections: {
    stateOf: (session, key) => key === 'contextPressure' ? pressureStates.get(session.id) : undefined,
  },
  compaction: {
    compactNow: async (agent, signal) => { compactions.push({ agent, signal }); return { shadowedSeqs: [1, 2], shadowedTokenCount: 40_000 } },
  },
  goals: {
    get: _agent => goalView,
    create: (_agent, request) => {
      goalOps.push(['create', request])
      goalView = { id: 'g-1', revision: 1, objective: request.objective, phase: 'active', roundsStarted: 0, maxGoalRounds: request.maxGoalRounds ?? 8, activation: 'armed' }
      return goalView
    },
    edit: (_agent, ref, request) => {
      goalOps.push(['edit', ref, request])
      goalView = { ...goalView, ...request, revision: goalView.revision + 1 }
      return goalView
    },
    clear: (_agent, ref) => {
      goalOps.push(['clear', ref])
      const cleared = { id: goalView.id, revision: goalView.revision + 1 }
      goalView = undefined
      return cleared
    },
  },
}
pressureStates.set('s-1', { pressureTokens: 80_000, contextWindow: 128_000, surfaceTokens: 79_000 })

// The host/plugin ctx: tools+agents only (the plugin's own inject).
const created = []
const disposed = []
const registeredByRealm = new Map()
const hostCtx = {
  tools: { register: () => () => undefined },
  agents: { list: () => [] },
  on: (event, handler) => {
    if (event === 'agent/created') created.push(handler)
    if (event === 'agent/disposed') disposed.push(handler)
    return () => undefined
  },
  effect: () => () => undefined,
}

await apply(hostCtx, {})
assert.equal(created.length, 1, 'apply subscribes to agent/created')

// One agent whose ctx exposes NOTHING by property (empty inject) but
// everything through get() — the run-7 lead/teammate reality.
const whenIdle = []
const agentCtx = guardedCtx(services, [])
const registered = []
agentCtx.tools = { register: (tool) => { registered.push(tool); return () => undefined } }
// tools must be reachable: declare it injected on the agent realm.
const agentCtxWithTools = new Proxy({ ...agentCtx, tools: { register: (tool) => { registered.push(tool); return () => undefined } } }, {
  get(target, prop) {
    if (prop === 'get') return (name) => services[name]
    if (prop === 'tools' || prop === 'on' || prop === 'effect') return target[prop]
    throw new Error(`cannot get property "${String(prop)}" without inject`)
  },
})
const followups = []
const agent = {
  ctx: agentCtxWithTools,
  session: { id: 's-1' },
  whenIdle: () => { whenIdle.push(1); return Promise.resolve() },
  runMaintenance: async () => undefined,
  followup: (message) => { followups.push(message) },
}
created[0]({ agent })

assert.equal(registered.length, 4, 'all four tools registered on the agent realm')
const status = registered.find(tool => tool.name === 'context_status')
const compact = registered.find(tool => tool.name === 'session_compact')
const goalSet = registered.find(tool => tool.name === 'goal_set')
const goalClear = registered.find(tool => tool.name === 'goal_clear')
assert.ok(status && compact && goalSet && goalClear)

// context_status must resolve the meter through get(), not the guard.
const statusValue = await status.execute({}, { agent, signal: new AbortController().signal })
assert.equal(statusValue.usedTokens, 80_000)
assert.equal(statusValue.contextWindow, 128_000)
assert.equal(statusValue.autoCompactAtTokens, Math.floor(128_000 * 0.45))
assert.equal(statusValue.baselineKind, 'estimate')
assert.deepEqual(measurements, [agent.session])

// session_compact schedules via whenIdle and compacts with the resolved service.
const compactValue = await compact.execute({ reason: 'before crawl' }, { agent, signal: new AbortController().signal })
assert.equal(compactValue.scheduled, true)
assert.match(compactValue.detail, /before crawl/)
await new Promise(resolve => setImmediate(resolve))
assert.equal(whenIdle.length, 1)
assert.equal(compactions.length, 1)
assert.equal(compactions[0].agent, agent)
// Jora post-mortem: after a finished compaction the agent continues ITSELF —
// one synthetic follow-up wakes the driver with the outcome.
assert.equal(followups.length, 1, 'compaction continues the agent via followup')
assert.match(followups[0].content[0].text, /<self_compact>/)
assert.match(followups[0].content[0].text, /Compaction finished/)
assert.equal(followups[0].source.kind, 'dst-comet')
assert.equal(followups[0].role, 'user')

// goal_set creates when no goal exists, then edits the current one in place.
let goalValue = await goalSet.execute({ objective: 'hunt the jora idor' }, { agent, signal: new AbortController().signal })
assert.equal(goalValue.action, 'created')
assert.equal(goalValue.goal.objective, 'hunt the jora idor')
assert.equal(goalValue.goal.phase, 'active')
goalValue = await goalSet.execute({ objective: 'widen to all bug bounty programs', max_goal_rounds: 40 }, { agent, signal: new AbortController().signal })
assert.equal(goalValue.action, 'edited')
assert.equal(goalValue.goal.objective, 'widen to all bug bounty programs')
assert.equal(goalValue.goal.maxGoalRounds, 40)
assert.equal(goalValue.goal.revision, 2)
// goal_clear drops it; a second clear says so honestly.
const clearedGoal = await goalClear.execute({}, { agent, signal: new AbortController().signal })
assert.equal(clearedGoal.action, 'cleared')
assert.equal(clearedGoal.goal, null)
await assert.rejects(
  goalClear.execute({}, { agent, signal: new AbortController().signal }),
  /no current goal/,
)
await assert.rejects(
  goalSet.execute({}, { agent, signal: new AbortController().signal }),
  /pass objective and\/or max_goal_rounds/,
)

// The old failure shape, demonstrated: property access on the guarded ctx throws.
assert.throws(() => agentCtxWithTools.tokenMeter, /cannot get property "tokenMeter" without inject/)

// Degraded realms: get() returning undefined surfaces the honest tool error,
// never the inject guard.
const bareCtx = new Proxy({ on: () => () => undefined }, {
  get(target, prop) {
    if (prop === 'get') return () => undefined
    if (prop === 'tools' || prop === 'on') return target[prop]
    throw new Error(`cannot get property "${String(prop)}" without inject`)
  },
})
const bareRegistered = []
bareCtx.tools = { register: (tool) => { bareRegistered.push(tool); return () => undefined } }
const bareAgent = { ctx: bareCtx, session: { id: 's-2' }, whenIdle: () => Promise.resolve(), runMaintenance: async () => undefined }
const applyHandlers = []
const hostCtx2 = {
  tools: { register: () => () => undefined },
  agents: { list: () => [] },
  on: (event, handler) => { if (event === 'agent/created') applyHandlers.push(handler); return () => undefined },
  effect: () => () => undefined,
}
await apply(hostCtx2, {})
applyHandlers[0]({ agent: bareAgent })
await assert.rejects(
  bareRegistered.find(tool => tool.name === 'context_status').execute({}, { agent: bareAgent, signal: new AbortController().signal }),
  /no token meter/,
)
await assert.rejects(
  bareRegistered.find(tool => tool.name === 'goal_set').execute({ objective: 'x' }, { agent: bareAgent, signal: new AbortController().signal }),
  /no goals service/,
)
// Jora post-mortem fix 1: the bare realm has the agent API but no resolvable
// compaction service — the tool now SCHEDULES anyway (the guard no longer
// demands the lazy service mid-turn; it is resolved at idle with one retry).
const bareCompactValue = await bareRegistered.find(tool => tool.name === 'session_compact').execute({}, { agent: bareAgent, signal: new AbortController().signal })
assert.equal(bareCompactValue.scheduled, true)

// Newer hosts expose tokenMeter.contextPressure() — that path must still win
// when present (and no projection lookup happens).
const methodCalls = []
const newerServices = {
  tokenMeter: {
    measure: () => ({ totalTokens: 10_000, baseline: { kind: 'usage' } }),
    contextPressure: (session) => { methodCalls.push(session); return { pressureTokens: 12_000, contextWindow: 64_000 } },
  },
  sessionProjections: {
    stateOf: () => { throw new Error('projection must not be read when the method exists') },
  },
}
const newerRegistered = []
const newerCtx = new Proxy({ tools: { register: (tool) => { newerRegistered.push(tool); return () => undefined } } }, {
  get(target, prop) {
    if (prop === 'get') return (name) => newerServices[name]
    if (prop === 'tools' || prop === 'on') return target[prop]
    throw new Error(`cannot get property "${String(prop)}" without inject`)
  },
})
const newerHandlers = []
const hostCtx3 = {
  tools: { register: () => () => undefined },
  agents: { list: () => [] },
  on: (event, handler) => { if (event === 'agent/created') newerHandlers.push(handler); return () => undefined },
  effect: () => () => undefined,
}
await apply(hostCtx3, {})
const newerAgent = { ctx: newerCtx, session: { id: 's-3' }, whenIdle: () => Promise.resolve(), runMaintenance: async () => undefined }
newerHandlers[0]({ agent: newerAgent })
const newerValue = await newerRegistered.find(tool => tool.name === 'context_status').execute({}, { agent: newerAgent, signal: new AbortController().signal })
assert.equal(newerValue.usedTokens, 12_000)
assert.equal(newerValue.contextWindow, 64_000)
assert.deepEqual(methodCalls, [newerAgent.session])

// Meter present but the projection key is absent (unregistered/not active):
// the tool must fail honestly, never report a zero window.
const meterOnlyServices = {
  tokenMeter: services.tokenMeter,
  sessionProjections: { stateOf: () => undefined },
}
const meterOnlyRegistered = []
const meterOnlyCtx = new Proxy({ tools: { register: (tool) => { meterOnlyRegistered.push(tool); return () => undefined } } }, {
  get(target, prop) {
    if (prop === 'get') return (name) => meterOnlyServices[name]
    if (prop === 'tools' || prop === 'on') return target[prop]
    throw new Error(`cannot get property "${String(prop)}" without inject`)
  },
})
const meterOnlyHandlers = []
const hostCtx4 = {
  tools: { register: () => () => undefined },
  agents: { list: () => [] },
  on: (event, handler) => { if (event === 'agent/created') meterOnlyHandlers.push(handler); return () => undefined },
  effect: () => () => undefined,
}
await apply(hostCtx4, {})
const meterOnlyAgent = { ctx: meterOnlyCtx, session: { id: 's-4' }, whenIdle: () => Promise.resolve(), runMaintenance: async () => undefined }
meterOnlyHandlers[0]({ agent: meterOnlyAgent })
await assert.rejects(
  meterOnlyRegistered.find(tool => tool.name === 'context_status').execute({}, { agent: meterOnlyAgent, signal: new AbortController().signal }),
  /no context pressure read available/,
)

console.log('PROBE PASS: context tools resolve services via ctx.get() under the cordis inject guard')
