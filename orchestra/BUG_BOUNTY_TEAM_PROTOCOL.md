## 8. DSH Agent-Team Orchestration (Bug-Bounty "Mother" mode)

When this workspace runs under DSH with Agent Teams mounted (`/team` reports the service; the profile carries `@deepseek-ai/dsh-experimental-agent-team-profile`), the session Lead operates as the **Mother/Coordinator**, not a solo hunter. Solo mode is the fallback when the team service is absent. Teammates are persistent conversations with their own context — treat them as colleagues who keep working, not as one-shot lookups.

### 8.1 Team shape

- **Mother (the Lead session):** decomposes the hunt into workstreams, spawns teammates, tracks the team task board, aggregates into `Progress/STATUS.md`. While site-teammates are working, the Mother does not grind target surfaces itself — it coordinates, reviews, and handles the human-facing asks.
- **Site teammates (max 3 concurrently):** one per engagement/surface (e.g. `launchdarkly-app`, `aiven-api`), spawned **fresh** (not forked — a fork drags the Mother's context along and defeats the point). Each owns one workstream folder `Progress/<platform>/<title>/` and does **real target work**: requests, browser driving, probe runs — not summary-writing. A teammate that only produces docs is a failed delegation; re-task or interrupt it.
- **`researcher` teammate (spawn once per session):** the methodology/vuln-knowledge lane. Reads and writes `Methods/` and `Docs/`, answers asks like "target uses Next.js 14 + GraphQL + Auth0 — give me the focused candidate list and precedents." **Never sends requests to targets** (docs-only, an offline librarian). Site-teammates query it by name instead of re-deriving methodology in their own context.

### 8.2 One shared browser, one tab each

The team shares ONE Playwright Chrome profile (cookies/session state shared — that is the feature, not a bug). Discipline:

- Each teammate opens its own tab and **owns** it; remember your tab index.
- Re-select your tab (`browser_tabs`) before EVERY `browser_*` call — never assume the active tab is still yours.
- Never close, navigate, or steal another member's tab. Artifacts land in `.playwright-mcp/`; prefix filenames with your teammate name.

### 8.3 Communication — small contexts, durable files

- `send_message` asks are short and specific; replies cap at ~15 lines. A status ask gets: last action, blockers, next step — 5 lines max.
- Want another member's state? Ask them, or read their `STATE.md`. Never paste or request full histories — that is how contexts bloat.
- Durable state lives in **files**: each teammate maintains `Progress/<platform>/<title>/STATE.md` (`DOING` / `DONE` / `NEXT` / `OPEN QUESTIONS` + key URLs/tabs/credential references), updated after every finding and before any pause. Files are the shared memory; chat is coordination only.
- Reusable insight (a technique that worked, a stack-specific gotcha): write it under `Methods/` and tell `researcher` where it is.

### 8.4 Compaction discipline (~450k of the 1M window)

- Sessions auto-compact around 45% context (profile default). At EVERY natural checkpoint — major finding logged, phase complete, long tool run about to start — update `STATE.md` FIRST (done / in-flight / exact next steps), then let compaction run. STATE.md is the post-compaction memory.
- After any compaction: re-read your `STATE.md` and `Progress/STATUS.md` before doing anything else.
- The Mother refreshes `Progress/STATUS.md` whenever a teammate reports a finding or completes a workstream.

### 8.5 Task board

The Mother keeps one task per workstream on the team task board, with dependencies between them; teammates claim/complete their own tasks. The board is coordination only — the files above stay the source of truth.

### 8.6 Escalation

Authorization ambiguity (§1), other users' data, report submission, or a teammate that appears stuck twice in a row: the Mother interrupts it, then asks the human. Section 1 always wins over throughput.
