## 8. DSH Agent-Team Orchestration (Bug-Bounty "Mother" mode, v2)

When this workspace runs under DSH with Agent Teams mounted (`/team` reports the service; the profile carries the agent-team bundle), the session Lead operates as the **Mother/Coordinator**, not a solo hunter. Solo mode is the fallback when the team service is absent. Teammates are persistent conversations with their own context — treat them as colleagues who keep working, not as one-shot lookups. Full design rationale: `orchestra/TEAM_DESIGN_v2.md` in the DST-Comet repo.

### 8.1 Team shape (standing roster 6 of 11, burst ≤4)

- **Mother (the Lead session):** decomposes the hunt, spawns/labels/freezes/releases lanes, resolves human walls, reviews, commits. **Never grinds a target surface herself.** Her context is the run's most expensive resource — ≤15-line messages, files for everything else.
- **Site walkers (2–3, one per active engagement):** spawned **fresh** (never forked). Each owns ONE engagement end to end — fixtures, surfaces, matrices, evidence, `Progress/<platform>/<title>/` + `STATE-<name>.md`. Real target work, not summary-writing.
- **`researcher` (1, cheap model via `spawn_teammate {model}`):** docs-only librarian. Reads/writes `Methods/`, answers stack→candidate asks **by file path**, keeps a rolling `Methods/QUEUE.md` so it is never idle. **Never sends requests to targets.**
- **`validator` (1, strong model):** takes every candidate from a worker — reproduces it standalone with its own accounts, kills what does not reproduce, drafts the report skeleton. Nothing is ever submitted unvalidated.
- **Burst slots:** a second-slice worker on a deep engagement (disjoint object prefix + own accounts), a wrap-up temp, or a bounded deep-dive. Never sit at the 11/11 cap.

**Lane lifecycle:** `spawn → scope_set {owner} → work → wrap (matrix + STATE + untested list) → release_teammate → slot free`. There is no rename: a lane that changes job is wrapped, **released**, and respawned under a name that says what it now does. The cap error lists every member — wrap and release the stalest lane instead of hunting.

### 8.2 One owner browser per teammate (Constellation)

Every browser call carries `owner: "<your teammate name>"`: own Chrome window, own profile, window title prefixed `[owner]`, and a **first-tab info label** (owner · job · engagement) the Mother sets at spawn with `browser_owner_info` and which cannot be closed. The shared no-owner session is the HUMAN's browser — never a worker's fallback.

- `browser_map` is the ownership map; scope is armed per lane (`scope_set {owner}`) at lane start and cleared at wrap (`scope_clear {owner}`).
- Lane wrap closes the owner session (`browser_close {owner}`); the profile persists for a return engagement.
- Captcha-walled login, the supported recipe: **captcha widgets do not mint tokens under automation — do not retry.** The human logs in in their own browser → `browser_cookies_export` (values stay server-side) → `browser_cookies_import` into the worker's owner browser. Default variant: the human types a password the agent generated; the agent never sees the human's own secret.

### 8.3 Communication — small contexts, durable files

- Messages ≤15 lines; a longer answer is a file + its path. State asks get: last action, blockers, next step.
- **Worker ↔ worker on the same engagement is allowed for state** (fixture handoffs, slice splits) with a one-line CC to the Mother; **plan changes never happen peer-to-peer** — scope, task reassignment, and re-slicing are the Mother's.
- Workers query `researcher` and hand candidates to `validator` by name. Durable state lives in files (`STATE-<name>.md` updated after every finding and before any pause); chat is coordination only.

### 8.4 Human walls — the queue, not the scrollback

When only a human can advance a page (captcha, login, emailed code): `human_task_create {title, steps[], done_when, lane, preserve_url}` — this parks **only your lane**; everyone else keeps working. The Mother is notified automatically, the ask appears pinned in the TUI **Human wall panel** (`!` tab) with your steps and buttons (done/failed/reply/open URL/jump to your Chrome window). After the human resolves: the Mother calls `human_task_resolve` and re-verifies `done_when` herself in your browser; you wake with the outcome and re-verify too. The Mother can queue a wall FOR a lane (`owner: "<teammate>"`) without parking herself, and tracks her own asks with `park: false`. Never retry a gated action in a loop — wall it.

### 8.5 Waiting and steering

The Mother's default loop is `wait_agent {timeout_ms: 60000–120000}` → wake → `team_snapshot {}` (roster + task load + who waits on a human + frozen lanes, one call) → act. A human message typed during a wait **wakes it instantly** (`user_input: true`) — read it and steer. `noProgress` means act or end the turn, never wait on a quiet team. Workers do not wait for each other; they end their turn idle and the Mother wakes them by message. A stuck lane gets `lane_freeze` (parks between calls, no mid-call kill), a look, then resume or release.

### 8.6 Compaction discipline (~450k of the 1M window)

Sessions auto-compact around 45% context. At EVERY natural checkpoint update `STATE-<name>.md` FIRST (done / in-flight / exact next steps + key URLs/tabs/credential references), then let compaction run. After compaction: re-read your STATE and `Progress/STATUS.md` before anything else. Evidence blobs never enter context — `http_download` (metadata + sha only) and screenshots go to per-owner artifact dirs.

### 8.7 Task board and escalation

One task per workstream with dependencies; workers claim/complete their own. Files stay the source of truth; the board is coordination. Authorization ambiguity (§1), other users' data, report submission, or a teammate stuck twice in a row: the Mother freezes it, then asks the human. Section 1 always wins over throughput.
