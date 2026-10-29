/**
 * DST Comet agent tools.
 *
 * Two model-facing tools the stock harness does not ship:
 *
 *  - `context_status`: the calling agent reads its own context pressure —
 *    used tokens, window, percent, and when auto-compaction triggers.
 *    Stock DSH feeds the token meter to the UI only; the model itself is
 *    blind. Sources: `tokenMeter.measure()` (current surface estimate)
 *    and the meter's registered 'contextPressure' session projection
 *    (last request's real prompt size + route capacity). Newer hosts
 *    expose that read as `tokenMeter.contextPressure()`; hosts through
 *    0.2.1-rc.2 (run-9 §1) have no such method, so the same state is
 *    read via `sessionProjections.stateOf(session, 'contextPressure')`.
 *
 *  - `session_compact`: the agent asks for compaction at a checkpoint IT
 *    chooses (the human `/compact` path is `compaction.compactNow()`,
 *    which requires an idle agent — `runMaintenance` throws mid-turn).
 *    A mid-turn tool call therefore schedules the compaction for the
 *    turn's end (`agent.whenIdle()`), with one retry on a racing wake via
 *    the `agent/status` event. The next turn starts from the compacted
 *    history.
 *
 * Run-5 advice §7 — two activation bugs, both fixed:
 *
 * 1. The plugin injected the LAZILY-mounted `compaction` service, so it
 *    sat "pending (waiting for service: compaction)" and `apply()` never
 *    ran — no agent ever saw the tools. `inject` now names only eager
 *    services.
 * 2. Host-realm service access: `compaction`/`tokenMeter` mount in each
 *    session's preset isolate realm, not the host realm a profile bundle
 *    lives in — a host-side `ctx.compaction` can stay undefined forever
 *    even though every session has the service. Tools are therefore
 *    registered PER AGENT on `agent.ctx` (the same scaffold the live-proven
 *    tool-agent-team uses), so every service lookup happens in the agent's
 *    own realm. Scoped registrations shadow globals, so this is safe even
 *    where a host lookup would have worked.
 *
 * Run-7 advice P0-4 — a third correction, and the definitive one: cordis
 * property access on a context is guarded (`cannot get property "tokenMeter"
 * without inject`) unless the name is in THAT context's inject list, and the
 * agent context does not inject compaction/tokenMeter. The sanctioned
 * inject-free lookup is `ctx.get(name)` ("read a service from the store
 * without the inject requirement", returning undefined while the providing
 * fiber is not active) — the same pattern upstream's translator uses for
 * optional service access. Every service read below goes through
 * `serviceCtx.get(...)`; the property syntax never appears again.
 *
 * @module @dst-comet/agent-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dst-comet-agent-tools'
export const inject = ['tools', 'agents']

/** Compact, retrying once if a racing wake beat the idle transition. */
function scheduleCompact(serviceCtx, agent) {
  const controller = new AbortController()
  const offDispose = serviceCtx.on('dispose', () => controller.abort())
  let retried = false
  const run = async () => {
    try {
      // Resolve the lazy service here: by turn end the runtime is mounted.
      const compaction = serviceCtx.get('compaction')
      if (compaction === undefined) throw Object.assign(new Error('no compaction service'), { code: 'no-service' })
      // null = nothing useful to compact; outcomes (including failures)
      // surface through the session log's compaction events either way.
      await compaction.compactNow(agent, controller.signal)
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
      if ((code === 'busy' || code === 'no-service') && !retried) {
        retried = true
        const off = serviceCtx.on('agent/status', payload => {
          if (payload.agent !== agent || payload.status !== 'idle') return
          off()
          void run()
        })
        return
      }
      // cancelled / changed / summary / commit / persistence: recorded in
      // the session log; nothing further for the tool to do post-turn.
    } finally {
      if (!retried) offDispose()
    }
  }
  void Promise.resolve(agent.whenIdle()).then(run, () => offDispose())
}

function formatTokens(tokens) {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

/** Both tool definitions bound to one agent's own service realm. */
function agentTools(serviceCtx, autoCompactRatio) {
  return [
    defineTool({
      name: 'context_status',
      description: "Report this session's current context usage: tokens used, the model's context window, percent used, and the token level where auto-compaction triggers. Call it before long phases, before producing large outputs, or whenever unsure how much context room remains.",
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            usedTokens: { type: 'integer', required: true },
            contextWindow: { type: 'integer', required: true },
            percentUsed: { type: 'number', required: true },
            autoCompactAtTokens: { type: 'integer', required: true },
            baselineKind: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Context: ${formatTokens(value.usedTokens)} / ${formatTokens(value.contextWindow)} tokens (${Math.round(value.percentUsed)}%); auto-compact at ${formatTokens(value.autoCompactAtTokens)}.`,
        }],
      },
      execute(_args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('context_status requires an owning agent session')
        const tokenMeter = serviceCtx.get('tokenMeter')
        if (tokenMeter === undefined) throw new Error('context_status: this runtime has no token meter')
        const measurement = tokenMeter.measure(agent.session)
        // Run-9 §1: hosts through 0.2.1-rc.2 ship no contextPressure()
        // method on the meter — the pressure state lives in the meter's
        // registered 'contextPressure' session projection, which is the
        // exact read the newer method wraps. Prefer the method, fall back
        // to the projection, fail loudly when neither is available.
        let pressure
        if (typeof tokenMeter.contextPressure === 'function') {
          pressure = tokenMeter.contextPressure(agent.session)
        } else {
          const projections = serviceCtx.get('sessionProjections')
          const state = projections?.stateOf(agent.session, 'contextPressure')
          if (state === undefined) {
            throw new Error('context_status: no context pressure read available (token meter present but no contextPressure projection)')
          }
          pressure = state
        }
        // pressureTokens is the last real request's prompt size; the
        // measurement is the live estimate since then. Report the freshest
        // honest number: the live estimate once it exists, else the anchor.
        const used = Math.max(pressure.pressureTokens ?? 0, measurement.totalTokens)
        const window = pressure.contextWindow ?? 0
        const autoCompactAt = window > 0 ? Math.floor(window * autoCompactRatio) : 0
        return Promise.resolve({
          usedTokens: used,
          contextWindow: window,
          percentUsed: window > 0 ? Math.round((used / window) * 1000) / 10 : 0,
          autoCompactAtTokens: autoCompactAt,
          baselineKind: measurement.baseline.kind,
        })
      },
      presentCall: () => ({ card: 'generic', title: 'Check context usage', kind: 'other' }),
    }),
    defineTool({
      name: 'session_compact',
      description: "Compact this session's older history into a summary to free context, at a checkpoint you choose. Compaction runs when the current turn ends and the next turn continues from the compacted history. BEFORE calling: write or update the workspace state file (STATE.md / progress notes) so nothing important lives only in the history being condensed. Pass reason to record why you are compacting (e.g. 'before large crawl phase').",
      parameters: {
        reason: { type: 'string', description: 'One line: why this checkpoint compacts now. Recorded with the schedule.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scheduled: { type: 'boolean', required: true },
            detail: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.detail }],
      },
      execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('session_compact requires an owning agent session')
        const compaction = serviceCtx.get('compaction')
        if (compaction === undefined || typeof agent.whenIdle !== 'function' || typeof agent.runMaintenance !== 'function') {
          throw new Error('session_compact: this runtime does not expose idle compaction')
        }
        scheduleCompact(serviceCtx, agent)
        const reason = typeof args?.reason === 'string' && args.reason.trim() !== '' ? ` Reason: ${args.reason.trim()}` : ''
        return Promise.resolve({
          scheduled: true,
          detail: `Compaction scheduled: it runs when this turn ends. The next turn continues from the compacted history — make sure the state file is current.${reason}`,
        })
      },
      presentCall: () => ({ card: 'generic', title: 'Compact session history', kind: 'other' }),
    }),
  ]
}

export async function apply(ctx, config) {
  const autoCompactRatio = typeof config?.autoCompactRatio === 'number' && config.autoCompactRatio > 0 && config.autoCompactRatio < 1
    ? config.autoCompactRatio
    : 0.45

  // Per-agent scoped registration (run-5 §7, fix 2): services resolve in the
  // agent's own realm. Disposers ride agent/disposed; the effect cleans the
  // map if the plugin unmounts first.
  const installed = new Map()
  const maybeInstall = (agent) => {
    if (installed.has(agent)) return
    const offs = agentTools(agent.ctx, autoCompactRatio)
      .map(tool => agent.ctx.tools.register(tool))
    installed.set(agent, () => { for (const off of offs) off() })
  }
  for (const agent of ctx.agents.list()) maybeInstall(agent)
  ctx.on('agent/created', ({ agent }) => maybeInstall(agent))
  ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent)?.()
    installed.delete(agent)
  })
  ctx.effect(() => () => {
    for (const dispose of installed.values()) dispose()
    installed.clear()
  }, 'dst-comet-agent-tools.scopedTools()')
}
