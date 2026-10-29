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
const agent = {
  ctx: agentCtxWithTools,
  session: { id: 's-1' },
  whenIdle: () => { whenIdle.push(1); return Promise.resolve() },
  runMaintenance: async () => undefined,
}
created[0]({ agent })

assert.equal(registered.length, 2, 'both tools registered on the agent realm')
const status = registered.find(tool => tool.name === 'context_status')
const compact = registered.find(tool => tool.name === 'session_compact')
assert.ok(status && compact)

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
  bareRegistered.find(tool => tool.name === 'session_compact').execute({}, { agent: bareAgent, signal: new AbortController().signal }),
  /does not expose idle compaction/,
)

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
