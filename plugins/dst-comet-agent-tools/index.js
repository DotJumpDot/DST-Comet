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
 * Jora post-mortem 2026-11-05 — three additions:
 *
 * 1. `session_compact` was DEAD in practice: its synchronous guard required
 *    `serviceCtx.get('compaction')` to resolve MID-TURN, but the lazy
 *    service is rarely resolvable while the turn is executing — the one
 *    live call (jora session seq 5557) threw "this runtime does not expose
 *    idle compaction" and the model honestly reported it could not
 *    self-compact. The guard now checks only the agent API; the service is
 *    resolved at idle (with the existing one retry). After a finished
 *    compaction the agent now CONTINUES ITSELF: a synthetic follow-up
 *    (source kind 'dst-comet', unknown kinds fall through by contract)
 *    wakes the driver so the next turn starts from the compacted history
 *    without waiting for the human — the exact "call it, then keep going"
 *    the Mother flow needs.
 *
 * 2. Image-capability rescue (agent/request-error + compaction/summary-error):
 *    the jora session died permanently when the opencode-go upstream stopped
 *    accepting images mid-run — every request 400'd with "image input is not
 *    available on this engine" and the stock offload executor only reacts to
 *    locally-raised IMAGE_OFFLOAD_REQUIRED (budget) failures, never to an
 *    upstream capability 400. This handler mirrors the executor's own walk
 *    (surface.nodes → eventAt → deriveEventMessage → append image/offload)
 *    and offloads ALL retained images on that error class, then retries.
 *    Images become durable "attachment + path" placeholders; the evidence
 *    files stay on disk.
 *
 * 3. `goal_set` / `goal_clear`: the stock update_goal gates edit/pause/resume
 *    behind a DIRECT human request and offers no clear at all, so a Mother
 *    lead could read and complete its goal but never change or drop it. The
 *    fork tools call the same `ctx.goals` service (create/edit/clear) without
 *    the human gate — optimistic CAS via optional goal_id+revision.
 *
 * @module @dst-comet/agent-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dst-comet-agent-tools'
export const inject = ['tools', 'agents']

/** Synthetic continuation prompt wrapped in a recognizable tag. */
function selfCompactFollowup(text) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: `<self_compact>\n${text}\n</self_compact>` }],
    // Unknown producer kinds fall through by contract (MessageSourceMap:
    // "user messages carry any producer's kind").
    source: { kind: 'dst-comet' },
  }
}

/** Wake the driver with the outcome so the agent keeps going post-compaction.
 *  followup opens a fresh turn even from true idle; a disposed agent throws,
 *  which is fine to swallow — there is nobody left to continue. */
function continueAfterCompact(agent, text) {
  try { agent.followup(selfCompactFollowup(text)) } catch { /* agent gone */ }
}

/** Compact, retrying once if a racing wake beat the idle transition, then
 *  continue the agent itself with the outcome (jora post-mortem fix 1). */
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
      const result = await compaction.compactNow(agent, controller.signal)
      continueAfterCompact(agent, result === null
        ? 'Compaction ran but found nothing useful to condense (history already tight) — context is unchanged. Continue the task.'
        : 'Compaction finished: older history is now a summary. Continue the task from where you left off — your pre-compaction state-file notes are authoritative; re-read key files instead of trusting condensed narration.')
      return result
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
      if ((code === 'busy' || code === 'no-service') && !retried) {
        retried = true
        const off = serviceCtx.on('agent/status', payload => {
          if (payload.agent !== agent || payload.status !== 'idle') return
          off()
          void run().finally(offDispose)
        })
        return
      }
      // cancelled / changed / summary / commit / persistence failures: tell
      // the agent instead of dying silently — it asked to compact, so it
      // owns recovering (re-try later, or surface to the human).
      const message = error instanceof Error ? error.message : String(error)
      if (code !== 'cancelled') continueAfterCompact(agent, `Self-compaction FAILED: ${message}. Continue if you can; tell the human if context is critically full.`)
      return undefined
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
      description: "Compact this session's older history into a summary to free context, at a checkpoint you choose. Compaction runs when the current turn ends, and you CONTINUE AUTOMATICALLY afterwards — a follow-up wakes you on the compacted history, no human input needed. BEFORE calling: write or update the workspace state file (STATE.md / progress notes) so nothing important lives only in the history being condensed. Pass reason to record why you are compacting (e.g. 'before large crawl phase').",
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
        // Jora post-mortem fix 1: the lazy compaction service is usually NOT
        // resolvable mid-turn (get() returns undefined while its fiber is
        // inactive), so checking it here killed every call. scheduleCompact
        // resolves it at idle; only the agent API is guaranteed upfront.
        if (typeof agent.whenIdle !== 'function' || typeof agent.runMaintenance !== 'function') {
          throw new Error('session_compact: this runtime does not expose idle compaction')
        }
        scheduleCompact(serviceCtx, agent)
        const reason = typeof args?.reason === 'string' && args.reason.trim() !== '' ? ` Reason: ${args.reason.trim()}` : ''
        return Promise.resolve({
          scheduled: true,
          detail: `Compaction scheduled: it runs when this turn ends, then you are woken to continue on the compacted history — make sure the state file is current first.${reason}`,
        })
      },
      presentCall: () => ({ card: 'generic', title: 'Compact session history', kind: 'other' }),
    }),
    // ── DST Comet goal self-service (jora post-mortem fix 3) ────────────────
    // The stock update_goal gates edit/pause/resume behind a DIRECT human
    // request and has no clear action; a Mother lead mid-run can therefore
    // read and complete its goal but never change or drop it. These fork
    // tools call the same ctx.goals service without the human gate.
    defineTool({
      name: 'goal_set',
      description: "Set or change this session's goal yourself (fork tool — no human request needed, unlike update_goal). With no current goal it creates one (objective required); with a current goal it edits the objective and/or the round cap in place. Use it when the mission changed, the old objective is done or wrong, or the round cap is too low to finish.",
      parameters: {
        objective: { type: 'string', description: 'The new completion objective. Required when creating; optional when editing (omit to keep).' },
        max_goal_rounds: { type: 'number', description: 'Replacement automatic-continuation round cap (optional).' },
        goal_id: { type: 'string', description: 'Optional compare-and-set id from the current goal (mismatched ids are rejected).' },
        revision: { type: 'number', description: 'Optional compare-and-set revision from the current goal.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true, enum: ['created', 'edited'] },
            goal: { type: 'object', required: true, additionalProperties: false, properties: {
              id: { type: 'string', required: true },
              revision: { type: 'number', required: true },
              objective: { type: 'string', required: true },
              phase: { type: 'string', required: true },
              roundsStarted: { type: 'number', required: true },
              maxGoalRounds: { type: 'number', required: true },
            } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `Goal ${value.action}: ${value.goal.objective} (round ${value.goal.roundsStarted}/${value.goal.maxGoalRounds}, phase ${value.goal.phase}, revision ${value.goal.revision}).` }],
      },
      execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('goal_set requires an owning agent session')
        const goals = serviceCtx.get('goals')
        if (goals === undefined) throw new Error('goal_set: no goals service in this runtime')
        const hasObjective = typeof args?.objective === 'string' && args.objective.trim() !== ''
        const hasCap = typeof args?.max_goal_rounds === 'number' && Number.isFinite(args.max_goal_rounds)
        if (!hasObjective && !hasCap) throw new Error('goal_set: pass objective and/or max_goal_rounds')
        const current = goals.get(agent)
        if (current === undefined) {
          if (!hasObjective) throw new Error('goal_set: no current goal — objective is required to create one')
          const created = goals.create(agent, {
            objective: args.objective.trim(),
            ...hasCap ? { maxGoalRounds: args.max_goal_rounds } : {},
          })
          return Promise.resolve({ action: 'created', goal: goalSummary(created) })
        }
        const ref = goalRefOf(args, current)
        const edited = goals.edit(agent, ref, {
          ...hasObjective ? { objective: args.objective.trim() } : {},
          ...hasCap ? { maxGoalRounds: args.max_goal_rounds } : {},
        })
        return Promise.resolve({ action: 'edited', goal: goalSummary(edited) })
      },
      presentCall: () => ({ card: 'generic', title: 'Set or change goal', kind: 'other' }),
    }),
    defineTool({
      name: 'goal_clear',
      description: "Clear this session's goal entirely (fork tool — no human request needed; there is no stock way to clear at all). Clears the objective, stops automatic goal rounds, and leaves the session goalless until a new goal is set. Prefer update_goal complete when the objective was actually achieved — clear is for abandoning or replacing a mission wholesale.",
      parameters: {
        goal_id: { type: 'string', description: 'Optional compare-and-set id from the current goal.' },
        revision: { type: 'number', description: 'Optional compare-and-set revision from the current goal.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true, enum: ['cleared'] },
            goal: { type: 'null', required: true },
          },
        },
        render: () => [{ type: 'text', text: 'Goal cleared: no active goal, automatic rounds stopped.' }],
      },
      execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('goal_clear requires an owning agent session')
        const goals = serviceCtx.get('goals')
        if (goals === undefined) throw new Error('goal_clear: no goals service in this runtime')
        const current = goals.get(agent)
        if (current === undefined) throw new Error('goal_clear: no current goal to clear')
        goals.clear(agent, goalRefOf(args, current))
        return Promise.resolve({ action: 'cleared', goal: null })
      },
      presentCall: () => ({ card: 'generic', title: 'Clear goal', kind: 'other' }),
    }),
  ]
}

/** Compact model-facing projection of one goal view. */
function goalSummary(goal) {
  return {
    id: goal.id,
    revision: goal.revision,
    objective: goal.objective,
    phase: goal.phase,
    roundsStarted: goal.roundsStarted,
    maxGoalRounds: goal.maxGoalRounds,
  }
}

/** Resolve the compare-and-set ref: caller-supplied when complete, else the
 *  current view's. The service rejects a stale or mismatched ref either way. */
function goalRefOf(args, current) {
  if (typeof args?.goal_id === 'string' && args.goal_id !== '' && typeof args.revision === 'number') {
    return { id: args.goal_id, revision: args.revision }
  }
  return { id: current.id, revision: current.revision }
}

export async function apply(ctx, config) {
  const autoCompactRatio = typeof config?.autoCompactRatio === 'number' && config.autoCompactRatio > 0 && config.autoCompactRatio < 1
    ? config.autoCompactRatio
    : 0.45

  // ── Image-capability rescue (jora post-mortem fix 2) ────────────────────
  // An upstream that stops accepting images mid-run 400s EVERY request
  // ("image input is not available on this engine") while the images live
  // permanently in the session log — the stock offload executor only reacts
  // to locally-raised IMAGE_OFFLOAD_REQUIRED budget failures, so the turn
  // dies and every later turn dies the same way. This handler mirrors the
  // executor's own walk and offloads ALL retained images on that error
  // class, then retries: images become durable "attachment + path"
  // placeholders and the request goes out text-only. Registered after the
  // executor (profile layer over base), so the executor's INVALID_REQUEST
  // passthrough reaches us and our retry wins the waterfall.
  const IMAGE_CAPABILITY_RE = /images?(?: inputs?)?(?:\s+(?:is|are)n't\s+|\s+(?:is|are)\s+not\s+|\s+not\s+)(?:available|supported)/i
  const offloadAllRetainedImages = (session, seqs) => {
    const targets = []
    for (const seq of seqs) {
      let event
      try { event = session.eventAt(seq) } catch { continue }
      if (event === undefined || (event.type !== 'user/message' && event.type !== 'tool/result')) continue
      let message
      try { message = session.deriveEventMessage(event) } catch { continue }
      if (message === undefined || !Array.isArray(message.content)) continue
      const imageIndexes = []
      let imageIndex = 0
      for (const block of message.content) {
        if (block === null || typeof block !== 'object' || block.type !== 'image') continue
        if (block.offloaded !== true) imageIndexes.push(imageIndex)
        imageIndex += 1
      }
      if (imageIndexes.length > 0) targets.push({ seq, imageIndexes })
    }
    if (targets.length === 0) return false
    session.append('image/offload', { targets })
    return true
  }
  ctx.on('agent/request-error', ({ agent, failure, signal }, next) => {
    if (failure?.code !== 'INVALID_REQUEST' || signal?.aborted) return next()
    if (typeof failure.message !== 'string' || !IMAGE_CAPABILITY_RE.test(failure.message)) return next()
    let handled = false
    try { handled = offloadAllRetainedImages(agent.session, agent.session.surface.nodes) } catch { handled = false }
    if (!handled) return next()
    try { ctx.logger?.warn?.(`dst-comet image rescue: upstream rejected image input (${failure.message.slice(0, 120)}); retained images offloaded to placeholders, retrying`) } catch { /* logging must never break rescue */ }
    return { kind: 'retry' }
  })
  // Same rescue for compaction summary requests: a summary carrying images
  // hits the same upstream wall, and the stock summary handler only listens
  // for IMAGE_OFFLOAD_REQUIRED. sourceEventSeqs bounds the walk.
  ctx.on('compaction/summary-error', ({ session, sourceEventSeqs, error, signal }, next) => {
    const message = `${error?.message ?? ''} ${error?.failure?.message ?? ''}`
    if (signal?.aborted || !IMAGE_CAPABILITY_RE.test(message)) return next()
    let handled = false
    try { handled = offloadAllRetainedImages(session, sourceEventSeqs) } catch { handled = false }
    return handled === true ? true : next()
  })

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
