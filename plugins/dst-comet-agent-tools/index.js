/**
 * DST Comet agent tools.
 *
 * Two model-facing tools the stock harness does not ship:
 *
 *  - `context_status`: the calling agent reads its own context pressure —
 *    used tokens, window, percent, and when auto-compaction triggers.
 *    Stock DSH feeds the token meter to the UI only; the model itself is
 *    blind. Sources: `ctx.tokenMeter.measure()` (current surface estimate)
 *    and `ctx.tokenMeter.contextPressure()` (last request's real prompt
 *    size + route capacity).
 *
 *  - `session_compact`: the agent asks for compaction at a checkpoint IT
 *    chooses (the human `/compact` path is `ctx.compaction.compactNow()`,
 *    which requires an idle agent — `runMaintenance` throws mid-turn).
 *    A mid-turn tool call therefore schedules the compaction for the
 *    turn's end (`agent.whenIdle()`), with one retry on a racing wake via
 *    the `agent/status` event. The next turn starts from the compacted
 *    history.
 *
 * Run-5 advice §7: these two sat "pending (waiting for service: compaction)"
 * for a whole live run — `compaction` mounts lazily, so an inject that names
 * it never resolves until a human runs /compact, and the tools never appear
 * in any agent's tool list. `inject` now names only the eager `tools`
 * service; `compaction` / `tokenMeter` are resolved on demand inside the
 * tool executes, when the session runtime is fully mounted.
 *
 * @module @dst-comet/agent-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dst-comet-agent-tools'
export const inject = ['tools']

/** Compact, retrying once if a racing wake beat the idle transition. */
function scheduleCompact(ctx, agent) {
  const controller = new AbortController()
  const offDispose = ctx.on('dispose', () => controller.abort())
  let retried = false
  const run = async () => {
    try {
      // Resolve the lazy service here: by turn end the runtime is mounted,
      // and touching ctx.compaction instantiates it on demand.
      const compaction = ctx.compaction
      if (compaction === undefined) throw Object.assign(new Error('no compaction service'), { code: 'no-service' })
      // null = nothing useful to compact; outcomes (including failures)
      // surface through the session log's compaction events either way.
      await compaction.compactNow(agent, controller.signal)
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
      if ((code === 'busy' || code === 'no-service') && !retried) {
        retried = true
        const off = ctx.on('agent/status', payload => {
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

export async function apply(ctx, config) {
  const autoCompactRatio = typeof config?.autoCompactRatio === 'number' && config.autoCompactRatio > 0 && config.autoCompactRatio < 1
    ? config.autoCompactRatio
    : 0.45

  ctx.tools.register(defineTool({
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
      const tokenMeter = ctx.tokenMeter
      if (tokenMeter === undefined) throw new Error('context_status: this runtime has no token meter')
      const measurement = tokenMeter.measure(agent.session)
      const pressure = tokenMeter.contextPressure(agent.session)
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
  }))

  ctx.tools.register(defineTool({
    name: 'session_compact',
    description: "Compact this session's older history into a summary to free context, at a checkpoint you choose. Compaction runs when the current turn ends and the next turn continues from the compacted history. BEFORE calling: write or update the workspace state file (STATE.md / progress notes) so nothing important lives only in the history being condensed.",
    parameters: {},
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
    execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('session_compact requires an owning agent session')
      if (ctx.compaction === undefined || typeof agent.whenIdle !== 'function' || typeof agent.runMaintenance !== 'function') {
        throw new Error('session_compact: this runtime does not expose idle compaction')
      }
      scheduleCompact(ctx, agent)
      return Promise.resolve({
        scheduled: true,
        detail: 'Compaction scheduled: it runs when this turn ends. The next turn continues from the compacted history — make sure the state file is current.',
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Compact session history', kind: 'other' }),
  }))
}
