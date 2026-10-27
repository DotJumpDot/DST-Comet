# DST-Comet team design v2 — the run-3 post-mortem, redesigned

Written 2026-10-27 after run 3 (5 teammates, 3 engagements, 2.5 h, 0 submissions, 0 false
positives) and the harness work that shipped the same day. This document is the target
operating design: **how many agents, what each one's job is, who talks to whom, and what
the Lead sees**. The companion `BUG_BOUNTY_TEAM_PROTOCOL.md` is the spawn-prompt version
of the same rules; keep the two in sync.

Why v2: run 3 worked, but every hour lost went to the same five places — (1) the Lead
slept through user steering inside `wait_agent`, (2) human walls scrolled away in the
transcript, (3) stale teammates held 4 of 11 slots with no way to remove them, (4) six
Chrome windows with no ownership map, (5) the Lead was the only broker for everything
(capTCHA sessions, mail links, fixture state). v2 makes each of those a first-class
primitive instead of a Mother-improvised dance.

---

## 1. The roster — 6 standing members, 4 burst slots

The cap is 11 (Lead + 10). Standing roster of 6 leaves 4 free, and free slots are a
feature: a second worker on a hot engagement is the single highest-value spawn (run 3's
two-worker Backblaze lane finished a 12-surface matrix while the one-worker lanes were
still in fixture setup).

| # | Member | Model | Job | Talks to |
|---|--------|-------|-----|----------|
| 1 | **Mother** (the Lead session) | session model | Decompose, spawn, freeze, release, resolve human walls, review, commit. **Never grinds a target surface herself.** | everyone (≤15 lines), human via chat + Human-wall panel |
| 2–4 | **site-walker-a/b/c** — one per active engagement | session model | Real target work for ONE engagement: fixtures, surfaces, matrices, evidence, `STATE-<name>.md` | Mother (status/asks); peers only for shared-engagement fixtures |
| 5 | **researcher** — docs-only librarian | **cheap model** (`spawn_teammate {model}`) | Methods/taxonomies/tier lists/precedents; answers "stack X → candidate list" asks. **Never touches a target.** Keeps a rolling `Methods/QUEUE.md` so it is never idle. | Mother; any worker by name |
| 6 | **validator** — candidate gate + report drafts | strong model | Takes every *candidate* from a worker: reproduces it standalone, kills false positives, writes the report package skeleton. Nothing is ever submitted unvalidated. | Mother; the worker that found it |

**Burst slots (max 4, never standing):**
- **second-slice worker** — same engagement as a site-walker, disjoint object namespace
  (`sc-` vs `ol-` prefixes) and its own accounts. Spawn when an engagement proves deep.
- **wrap-up temp** — spawned to close a lane (matrices + untested list) while the lane's
  original worker has already moved to a new engagement.
- **one-off deep-dive** — a bounded question that would otherwise blow a worker's context.

### Lane lifecycle (the part v1 lacked)

```
spawn → brief_capture → scope_set {owner} → work → wrap (matrix + STATE + untested list)
      → release_teammate → slot free
```

- `release_teammate` (new) removes a finished or stale member **and frees its name and
  slot**. There is no rename: repurposing a lane = wrap → release → spawn with a new
  name that says what it now does. A name like `ynab-worker` that now hunts Klaviyo is a
  lie on the board — release it.
- The cap error now lists every member with its phase, so "why can't I spawn" is
  answered by the error itself.
- Never sit at 11/11. If a spawn is refused, the release list is right there in the
  error — wrap and release the stalest lane instead of hunting for who is idle.
- Workers end their turn idle (waiting is the Lead's job); the Lead never parks herself
  on a lane (`human_task_create {park:false}` exists precisely so the Mother can queue
  her own asks and stay running).

## 2. Who talks to whom — team-to-team is allowed, decisions are not

Peer messaging is real and encouraged for **state**, forbidden for **plan**:

- ✅ worker ↔ worker on the SAME engagement: fixture handoffs ("account B is
  `+tag2@`, seed is X, my `STATE-*.md` has the object ids"), "I'm taking the `/api/v1`
  slice, you take the webhooks". One-line CC to the Mother so the board stays truthful.
- ✅ worker → researcher: methodology asks by name. The researcher replies with a file
  path, not an essay.
- ✅ worker → validator: candidate handoff = file path + repro steps + control evidence.
- ❌ nobody re-slices work, re-opens scope, or reassigns tasks peer-to-peer. The task
  board's claim/reassign is the Mother's; scope changes are the Mother's with the human
  in the loop.
- Every message ≤15 lines. A reply that needs more is a file + a path. The Mother's
  context is the run's most expensive resource; treat it like prod.

## 3. What the Lead sees (sightlines, one call each)

| Question | Answer |
|----------|--------|
| What is everyone doing? | `team_snapshot {}` after EVERY wake — roster + task load + `waitingOnHuman` + frozen lanes in one call. Not `list_agents` + `team_task_list` + guessing. |
| Where is the human needed? | The TUI **Human wall panel** (`!` tab): every open ask pinned with steps, `done`/`failed` buttons, reply, open-URL, and a jump-to-the-owning-Chrome button. The transcript can scroll; the panel cannot. |
| Whose Chrome window is this? | Every owner window opens with an **info tab** (`[owner] — job — engagement`); the Mother labels it at spawn with `browser_owner_info`. `browser_map` shows the whole ownership map. |
| Did my message land? | `wait_agent` now returns `user_input: true` the instant a human message arrives (no more Esc-and-resend), and `inbox_message: true` for peer relays. |
| Is a lane stuck? | Frozen lanes + `waitingOnHuman` in the snapshot; a worker that reports "stuck" twice gets `lane_freeze`, a look, then resume or release. |

## 4. The human wall — the canonical loop

This is the run's defining interaction, now first-class end to end:

```
worker hits a wall (captcha/login/OTP)
  → human_task_create {title, steps[], done_when, lane, preserve_url}
      (parks THAT lane only — everyone else keeps working)
  → Mother is messaged ("human wall: …") and wakes from any wait
  → human opens the Human wall panel, expands the ask,
      clicks the Chrome button (window comes forward),
      does the thing in THEIR OWN browser or the preserved tab,
      hits d (done) or f (failed) — or types a reply (m)
  → Mother reads the panel's message, calls human_task_resolve,
      re-verifies done_when HERSELF in the lane's browser
  → parked worker wakes with the outcome + post-condition, re-verifies, continues
```

Rules that keep it honest:
- **Only the asking lane parks.** A wall never stops the run.
- The captcha recipe (documented, use it): **captcha widgets do not mint tokens under
  CDP automation — do not retry.** Human solves it in their own browser →
  `browser_cookies_export` (values stay server-side, transcript sees only names) →
  `browser_cookies_import` into the worker's owner browser. "Human creates the account
  with OUR generated password, agent never receives the human's secret" is the default
  variant.
- The Mother can queue a wall FOR a lane (`owner: "<teammate>"`) without losing her own
  turn, and can track her own asks with `park: false`.

## 5. Waiting and steering — the Lead's loop

- The Mother's default state is `wait_agent {timeout_ms: 60000–120000}` → wake →
  `team_snapshot` → act. No polling loops, no sleeping.
- **A human message typed during a wait now wakes it instantly** (`user_input: true`).
  When you see it: read the new user message, steer the plan, THEN go back to waiting.
  Esc-abort is no longer part of this loop.
- `noProgress` (no other member running) means the Mother should act or end her turn —
  never wait on a quiet team.
- Workers do NOT `wait_agent` for each other; they end their turn idle and the Mother
  wakes them by message when there is work.

## 6. Browser ownership (Constellation)

- One owner browser per teammate (`owner:` on every browser call), own profile, own
  window, title-prefixed `[owner]`, info tab pinned at index 0 (not closable; the
  harness re-opens it).
- The Mother labels every window at spawn: `browser_owner_info {owner, job, engagement}`.
- Lane scope is armed per owner at lane start (`scope_set {owner, …}`) and cleared at
  wrap (`scope_clear {owner}`) so a stale rule cannot deny the next engagement.
- Lane wrap closes the owner session (`browser_close {owner}`); the profile persists on
  disk if the engagement returns.
- The shared (no-owner) session is the HUMAN's browser — harness tools use it only for
  things the human asked for; it is never a worker's fallback.

## 7. Context discipline (unchanged from v1, still load-bearing)

- STATE-before-compaction at every checkpoint; ~45% auto-compact stays.
- Durable state in files (`Progress/<lane>/STATE-<name>.md`), coordination in ≤15-line
  messages, methodology in `Methods/` via the researcher.
- Evidence blobs never enter context: `http_download` (metadata + sha only),
  `browser_take_screenshot`, per-owner artifact dirs.

## 8. What v2 deliberately does NOT do yet (next advice file, probably)

- `team_wrapup` — one command to freeze-all, collect STATEs, close board, print summary
  (today it is 5 hand-written messages + 2 waits).
- Message digesting — the Mother still reads every peer message in full; at 10 members
  × 20 updates that is the next context cliff.
- `brief_capture` — normalized engagement briefs straight into `scope_set`.
- Incremental scope edits (`scope_add`/`scope_remove`) + TTL on rules.
- Payment/identity data guard as an enforced policy (today it is prompt-only).
- `report_package_create` scaffolding, long-running install jobs as first-class.

---

## Appendix A — standing spawn prompts (templates)

**site-walker** (per engagement):
```
spawn_teammate {name: "<eng>-a", description: "<eng> lane: surfaces + matrices",
  model: <session model>, prompt: <brief + AGENTS.md rules + this protocol §4–7 +
    "your browser owner is your name; the Mother labels your window; one engagement;
    disjoint prefix '<xx>-' for every object you create; STATE-<name>.md after every
    finding; walls go to human_task_create, never to retry loops">}
→ browser_owner_info {owner: "<eng>-a", job: "<eng>: <one line>", engagement: "<eng>"}
→ scope_set {owner: "<eng>-a", in_scope: […], out_scope: […]}
```

**researcher** (cheap model): docs-only, rolling queue, answers by file path.

**validator** (strong model): "you touch candidates only; reproduce standalone with
your own accounts; kill what does not reproduce; every keep gets a report skeleton."

## Appendix B — what shipped on 2026-10-27 to make v2 real

- Engine fork: `wait_agent` wakes on user input (pending steer is caught by an inbox
  pre-check), `release_teammate` (+cap errors listing members), `human_task_create
  {park:false, owner}` with a `human-meta:` footer the TUI parses.
- Constellation-MCP: cookie handoff (export/import, server-side values), iframe
  `frame:` params + `browser_frames_list` + `browser_set_files`, `http_download` +
  HTTP basic/bearer auth, mail fixes (multi-header alias match, special-use folder
  detection, real error strings, `mail_get`, `mail_status`, app-password space strip),
  owner info tabs, `browser_click {force,x,y}`, `browser_type {submit}` navigation
  settle. 46 tools total.
- TUI: the Human wall panel (pinned queue + done/failed/reply/open/focus-Chrome),
  Agents-panel footer (task tabs + folded count moved under the list), whalegirl
  visible at panel widths ≥26 with a 28×20 large mode, compact cards for every
  engine-fork team tool.
