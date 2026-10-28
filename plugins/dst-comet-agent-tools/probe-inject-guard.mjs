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
const services = {
  tokenMeter: {
    measure: (session) => { measurements.push(session); return { totalTokens: 73_000, baseline: { kind: 'estimate' } } },
    contextPressure: () => ({ pressureTokens: 80_000, contextWindow: 128_000 }),
  },
  compaction: {
    compactNow: async (agent, signal) => { compactions.push({ agent, signal }); return { shadowedSeqs: [1, 2], shadowedTokenCount: 40_000 } },
  },
}

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

console.log('PROBE PASS: context tools resolve services via ctx.get() under the cordis inject guard')
