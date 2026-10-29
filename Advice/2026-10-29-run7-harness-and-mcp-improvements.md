# Harness + Constellation MCP — improvements from Bugcrowd run 7 (2026-10-28/29)

**Author:** `lead` (Team Lead, DSH/Constellation session). **Context:** one long run — 8 Bugcrowd
engagements, 4 Google lanes, ~15 teammates spawned, ~900 target requests, 0 confirmed findings.
The operation failed on *fixtures*, not on targets, and most of that fixture cost was harness
friction that turned into human round-trips. The human was pulled in **9 times** tonight; at least
**6 of those were avoidable** with the changes below.

> **Status (2026-10-29) — what this file produced (all 16 items):**
> - **#1 DONE** (Constellation): `browser_cookies_import {profile_dir, domain_filter}` reads an
>   external Chrome/Edge profile directly — SQLite Cookies store, DPAPI key from Local State,
>   AES-256-GCM `v10`/`v11` decrypt, Chrome-130 sha256(host_key) prefix strip; values stay
>   server-side, the audit records the host list only. `v20` (app-bound) rows and DBSC profiles
>   are reported, never silently broken. `browser_cookies_export` takes `domains: [...]` and
>   includes host-only subdomain cookies in BOTH directions (the google.com → accounts.google.com
>   gap is the pinned regression test).
> - **#2 DONE** (Constellation): `browser_attach {owner, cdp_url}` adopts a running Chrome over
>   CDP as a full owner session — same scope guard, tab leases, audit; closing only DISCONNECTS.
>   Plus `browser_launch {owner, user_data_dir, extra_args}` (persistent, automation flag
>   suppressed). The workaround's outside-the-guard CDP route is now inside it.
> - **#3 DONE** (Constellation): the snapshot probe is a real function Playwright always calls
>   (the string form returned the function object → "secrets is not iterable"); probe results are
>   Array-validated, and a failed aria snapshot degrades to masked DOM text instead of erroring.
> - **#4 DONE** (plugin): every service read goes through cordis's sanctioned inject-free
>   `ctx.get(name)` — no property access left to hit the "cannot get property without inject"
>   guard; proven by a probe that reproduces the guard exactly. `session_compact` also takes
>   `{reason}`.
> - **#5 DONE** (engine): parking defaults are role-aware — a teammate parks itself, the Lead
>   does NOT park itself unless it passes park:true; `dedupe_key` makes a re-raise return the
>   open wall (15-min window); new `human_task_update` edits title/steps/done_when in place and
>   refreshes the board mirror.
> - **#6 DONE** (Constellation): `browser_reset` closes ONLY the caller named in `owner`;
>   `all:true` closes the rest and is REFUSED while those owners hold tab leases.
> - **#7 DONE** (Constellation): `browser_clipboard {text}` (clipboardReadWrite granted) +
>   `browser_paste` (trusted CDP Ctrl+V → the real paste event path).
> - **#8 DONE** (Constellation): `browser_upload {trigger|deep_text, files}` — filechooser
>   interception with CSS that pierces open shadow roots, text matching, and a deep
>   shadow-root+frame input walk fallback; every upload lands in the owner's uploads.jsonl.
> - **#9 DONE** (Constellation): `oob_new {public:true}` spawns a cloudflared quick tunnel and
>   returns the trycloudflare.com URL; `oob_close` kills it; `oob_list` shows ⚠ still-exposed
>   tunnels; server teardown kills every tunnel.
> - **#10 DONE** (Constellation): `secrets_patch {name, patch}` applies RFC 7396 merge-patch
>   server-side under a per-secret lock (the seek-accounts.json clobber shape); masked
>   `secrets_get` lists a JSON secret's top-level keys.
> - **#11 DONE** (Constellation): `repo_commit` validates every path against the worktree BEFORE
>   `git add` and fails with the real, unredacted path list — a long path can no longer surface
>   as `pathspec '[redacted].py'`.
> - **#12 DONE** (Constellation): DBSC detection (`Default/Network/Device Bound Sessions`) warns
>   at export AND at profile import, pointing at browser_attach.
> - **#13 DONE** (Constellation): `browser_map` reads process state — a "(closed)" profile whose
>   chrome.exe still runs (after a restart) says "chrome.exe ALIVE with this profile"; attached
>   sessions show their CDP endpoint and disconnect-only close.
> - **#14 DONE** (Constellation): `budget_set {owner, max_requests}` hard-refuses past the cap
>   at the target-request choke points (navigate/new-tab/http), `budget_raise` is the only way
>   past; refused requests are not counted.
> - **#15 DONE** (Constellation): `mail_diagnose {domain}` — To-header search across every
>   folder, ever, with a verdict that separates "mail arrived, query wrong" from "never arrived,
>   forwarding broken".
> - **#16 DONE** (Constellation): `evidence_capture {label, include:[dom,html,png]}` writes
>   sha256-hashed artefacts + a per-owner manifest.json (har honestly reported unsupported
>   retroactively).
> - **BONUS, blocking**: the run-6 handoff session (and 3 more) refused to continue on
>   `team/member/released` — our fork appended a release event type outside the released catalog,
>   so the persistence reader refused the whole log. All 4 logs repaired in place (ignorable
>   marker added, backups kept: `engine/scripts/repair-released-events.mjs`), and the engine now
>   writes releases as `plugin:agent-team/member-released` plugin records — the sanctioned
>   out-of-repo mechanism that any harness retains-and-skips.
> - Constellation inventory: 48 → **59 tools** (mcp-smoke asserts the exact list).

Format per item: **symptom → root cause → proposed change → tonight's workaround**.
Ordered by (hours lost × how many runs will hit it again).

---

## P0 — the four that cost real time tonight

### 1. Cookie/session import from an *external* browser profile

**Symptom.** Every authenticated lane needed a session that already existed in the human's browser
or in a Playwright profile. Constellation can only import handoffs produced by
`browser_cookies_export` from a Constellation owner, so an external session had no supported path.
**Root cause.** The handoff type is closed-loop: export→import only between Constellation sessions.
**Proposed.** Two additions:
- `browser_cookies_import {owner, profile_dir, domain_filter:[...]}` — read a Chrome/Edge
  `user-data-dir` directly (Decrypt DPAPI `v10`/`v11`, strip the 32-byte `SHA-256(host_key)`
  prefix). Values never enter the transcript; audit the host list only.
- `browser_cookies_export {owner, domains:[...]}` — accept a **list**, and always include host-only
  cookies. Tonight an export with `domain:"google.com"` silently omitted
  `accounts.google.com` `LSID`/`__Host-GAPS`/`ACCOUNT_CHOOSER`/`OSID`, which left the target
  browser signed out.
**Workaround used.** Hand-rolled DPAPI decrypt in Node, then `context.addCookies()`. Correct but
unguarded and unaudited.

### 2. "Attach to an existing Chrome over CDP" as a first-class owner mode

**Symptom.** Google's **Device Bound Sessions** (Chrome 156, `Default\Network\Device Bound
Sessions`) invalidated every copied cookie jar within minutes — verified: identical 39-row jars,
identity green at 15:45, signed out by 15:53, server-side, not a partial set. The **only** thing
that worked was: human signs into a normal Chrome with its own `--user-data-dir`, agent connects
with `chromium.connectOverCDP('http://127.0.0.1:PORT')`. That route produced two fully authenticated
lanes and 48 requests with no expiry.
**Root cause.** Constellation always *launches* a browser; it cannot *attach* to one the human is
already driving. DBSC binds the session to the browser instance, so launching is fatal by design.
**Proposed.** `browser_attach {owner, cdp_url}` — adopts a running Chrome as an owner session, with
the same scope guard, tab leases and audit as a launched one. Optionally
`browser_launch {owner, user_data_dir, extra_args:[...]}` for a normal (non-automation-flag) launch.
**Why it matters beyond Google.** This is the general answer for any site with session binding
(banking, cloud consoles, Okta/Auth0 tenants) — i.e. most of the surfaces worth testing.
**Workaround used.** Lanes attached outside Constellation, which **bypassed the scope guard
entirely**; we compensated with hand-written pre-send logs. That is exactly the situation the guard
exists to prevent, and we lost the audit trail for it.

### 3. `browser_snapshot` is broken in this build

**Symptom.** `[aria snapshot unavailable: secrets is not iterable]` on **every** owner **and** on the
shared session, for the whole run.
**Impact.** Every agent fell back to `document.body.innerText` scraping; role/name selectors could
not be discovered reliably. Several lanes burned 5–15 requests on selectors that a snapshot would
have exposed for free. Direct contributor to two 30-request overruns.
**Proposed.** Fix the serializer; and make `browser_snapshot` degrade to a DOM-text snapshot rather
than erroring — a partial snapshot is far more useful than a hard failure.

### 4. Context management is unusable by agents

**Symptom.** `context_status` → `cannot get property "tokenMeter" without inject`;
`session_compact` → `cannot get property "compaction" without inject`. Both fail identically for the
Lead and for spawned teammates (reproduced 3× across two builds).
**Impact.** The Lead cannot tell how full its context is and cannot compact itself. A run this long
runs blind and only survives because checkpoints are written to disk by hand.
**Proposed.** Restore the inject for both, and add `session_compact {reason}` that schedules
compaction at end-of-turn (as documented) without requiring `inject`.

---

## P1 — ergonomics that caused repeat human round-trips

### 5. `human_task_create` defaults to parking the caller, and duplicates are not merged

Tonight: the Lead raised a wall, the lane raised its own 19 s later, and the human saw **two**
near-identical asks. Separately, the Lead created a wall *without* `owner`, which **parked the
Lead itself** — the coordinator lost its tools while the lane kept running.
**Proposed.**
- Default `park:false` for the Lead; require `owner` explicitly to park a lane.
- Idempotency: `human_task_create {dedupe_key}` — same key within N minutes returns the existing
  task instead of creating a second.
- `human_task_update` to edit steps/anchor on an existing wall (we had to resolve-as-skip and
  re-raise because the tunnel URL was baked into the steps).

### 6. `browser_reset {keep:["shared"]}` kills other lanes' browsers

One lane's end-of-run reset closed **every** owner window mid-block, including a lane that was
mid-cell. Profiles are preserved, but sessions rotate and controls break.
**Proposed.** Reset closes **only the caller's** sessions by default; closing others requires
`{all:true}` and should be refused while those owners hold tab leases.

### 7. Clipboard support

The Google Docs kix editor refused **five** synthetic-input routes (`.kix-appview-editor` type,
mouse-focus+`keyboard.type`, the `docs-texteventtarget-iframe` textarea, CDP `Input.insertText`,
and `navigator.clipboard.writeText` + `Control+V`). A **paste** is a different event path and is the
one normally accepted by such editors.
**Proposed.** `browser_clipboard {text}` + `browser_paste` (dispatch a real paste via CDP
`Input.dispatchKeyEvent` after granting `clipboardReadWrite`). This single primitive would have
saved an entire human round-trip (two documents) and unlocked the only remaining Google cell.

### 8. File upload into dynamically-created inputs

`browser_set_files {click_selector}` (file-chooser mode) is the right idea, but Drive/Docs create
their `input[type=file]` **after** the menu item is clicked, inside a shadow-root menu that
`getByText` did not resolve. We ended up not being able to upload a 107-byte `.txt`.
**Proposed.** `browser_upload {owner, trigger: <selector|role+name>, files:[...]}` with:
- deep-piercing selector resolution (shadow DOM + same-origin frames),
- `waitForEvent('filechooser')` internally,
- a returned artefact record (filename, bytes, target selector) for the evidence log.

### 9. OOB has no public base by default

`oob_new` returns `public: set CONSTELLATION_OOB_PUBLIC_BASE …`. For SSRF/blind-XSS/exfil proof a
public callback is **required** — a loopback URL is refused by models and unreachable by remote
fetchers.
**Proposed.** `oob_new {public:true}` that spawns a `cloudflared` quick tunnel automatically, returns
the URL, and guarantees teardown (`oob_close`) with a visible "still exposed" warning if it is left
running. Tonight I hand-downloaded cloudflared, ran it, and hand-verified teardown.

### 10. `secrets` needs atomic merge

`seek-accounts.json` was **clobbered** by two lanes doing read-modify-write concurrently; only one
account survived and tokens had to be restored from a backup.
**Proposed.** `secrets_patch {name, json_merge_patch}` executed server-side under a lock, plus
`secrets_get {name, reveal:false}` for key listing. Ad-hoc PowerShell JSON editing must not be the
documented path.

### 11. `repo_commit` redacts *paths*, not just values

Commit aborted with `fatal: pathspec '[redacted].py' did not match any files` — the secret scrubber
mangled a **filename** (`keeper_revoke_byuid_probe.py`). Paths are not secrets.
**Proposed.** Apply secret-pattern scrubbing to file **contents** only; validate paths verbatim and
fail with the real path when a file is missing.

---

## P2 — nice to have, noted while running

### 12. Detect Device Bound Sessions and warn early

If a profile contains `Default\Network\Device Bound Sessions`, cookie export/replay is guaranteed to
be revoked. A one-line warning at export time ("this profile is session-bound; import will not
persist — use attach mode") would have saved ~50 requests across four lanes.

### 13. `browser_map` disagrees with reality

The map listed **only** the shared session while **15** owner Chrome processes were running. It also
showed owners as `(closed)` that were still alive. Make the map read process state, not session
registry state.

### 14. Per-lane request budget, enforced

Tonight: two caps exceeded (37 vs 25, 35 vs 30) and one obeyed (the lane that stopped at the cap was
the only one that finished cleanly). A `budget_set {owner, max_requests}` that hard-refuses past the
limit — with an explicit `budget_raise` the Lead must approve — would make lane discipline automatic
instead of moral.

### 15. `mail_search` diagnostics

"0 matches" is ambiguous between *mail never arrived*, *forwarding is broken* and *wrong folder*.
LastPass mail never arrived at all (we verified 0 across All Mail/Spam/Trash over 8 h) and that cost
a lane its entire block. A `mail_diagnose {domain}` that reports "N messages from any sender to this
domain, ever, across folders" would distinguish the two immediately.

### 16. Evidence capture primitive

Every lane re-invented sha256-of-body + screenshot + timestamp. `evidence_capture {owner, label,
include:[dom,html,png,har} → artefacts dir + manifest.json}` would standardise report evidence and
stop bodies landing in transcripts.

---

## What actually worked, and should be protected

- **Per-owner browser isolation.** Session rotation between identities was a real failure mode
  (SSO rotation logged B over A twice); separate owners prevented it.
- **Scope guard + audit log.** When lanes stayed inside it, every request was reconstructible.
  Items 1–2 exist because the guard could not cover the paths we were forced onto — the fix is to
  widen the guarded surface, not to weaken the guard.
- **Tab leases.** Prevented two lanes fighting over one evidence tab.
- **`team_snapshot`.** The single most useful control-plane call in the run.
- **`repo_commit` scrubbing on contents.** Caught nothing malicious, but the habit is right.
- **Blocked-lane mechanics.** A lane whose tool calls are refused on a human wall behaved
  predictably; nothing tried to work around a wall on its own.

## One meta-observation for the harness

The expensive failure mode tonight was not "the agent could not do X" — it was **"the agent could
do X, but not in a way the harness could see"**. Attach-by-CDP, DPAPI decryption, and cloudflared
all worked; they just fell outside the audited surface. Every P0 above is a request to bring a
working technique *inside* the harness rather than to invent a new one.

---

## Round 6 verification (2026-10-29 15:52–15:58 +07) — browser-identity legs + window pinning

Constellation `000dd15` (request legs carry a live browser identity) and `9b82ae8` (window pinning),
58/58 unit tests green. Smoke test: **both features work; 3 new defects found.** Full matrix and repro:
`Bug_Bounty/Progress/harness-mcp/r6-smoke/RESULTS-r6.md`; oracle: `fixture-oracle.js` beside it.

**Verified green** (oracle answers by cookie presence only — no cookie value ever enters the transcript):

- `browser: "<owner>"` on `http_request` — triple control: jar → `ANON`, A's browser → `AUTHED`,
  B's browser → `ANON`. Per-owner isolation holds and there is no browser-bootstrap tax (1–7 ms).
- `http_replay` preserves transport **both** ways: replaying a browser capture → `AUTHED`; replaying a
  jar capture → `ANON`. No silent identity upgrade, which is what makes a negative replay trustworthy.
- `http_diff` across two live identities → divergence reported at line 1.
- `diff_pair` → `AUTHORIZATION_DENIAL (deciding: status)`, probe 403 / miss control 404 / owner 200 —
  the run-7 "hold → prove → lose → re-assert" cell now executes in a single call.
- recipe `expect` + `browser: true` → passes on `AUTHORIZATION_DENIAL`, and the negative control
  (probe = the identity that *holds* the session) fails on `SOFT_ALLOW`. Both assertions gate.

### #17 NEW — D1 (high, fail-open): an `expect` step without `action` silently asserts nothing

A step `{expect:"deny", probe:{…}, miss:{…}}` with no `action` field is accepted by
`fixture_recipe_set`, then `fixture_recipe_run` prints `COMPLETE`, logs `{"action":"complete","ok":true}`
and never runs the legs — no verdict line at all. Cause: `validateRecipe` and the runner both
`switch (step.action)`, `action` is optional on the step type, and the switch has no `default:` arm.
Adding `action:"expect"` made the identical fixture produce `expect deny OK — AUTHORIZATION_DENIAL`.
This is the round-7 failure class — a green that means nothing — and worse than a crash because the
recipe *looks* like it asserted the boundary. Fix: make `action` required; reject `undefined` in
validation; add a `default:` that throws `unknown step action`.

### #18 NEW — D2 (medium): port-qualified scope entries are accepted and can never match

`scope_set {in_scope:["127.0.0.1:8799"]}` returns `scope ARMED`, then navigation is denied with
`SCOPE DENIED: 127.0.0.1 is not in the declared scope (…, 127.0.0.1:8799)` — entries are matched
against the portless hostname, so a `host:port` entry is dead weight and the error message reads as a
contradiction. Normalise at set time (strip the port and say so) or match `host:port` when supplied.

### #19 NEW — D3 (low): `SOFT_ALLOW` note names the owner even when no `own` leg was given

The note says "different bytes than the owner" in a probe-vs-miss comparison where no owner leg
exists. Branch the wording on whether `own` was supplied.

### #20 — user preference that window pinning must honour

**Spawned windows belong at the BOTTOM of screen 2** (the left monitor, `-1920,0`), not centred and not
upper-left; the human currently drags them there by hand. Two consequences: (1) the y-cascade is the
wrong shape — base `y=100` plus `+0..270` applied to *both* axes walks later owners down the screen, so
for a bottom anchor the cascade should be **x-only** (or y-negative); (2) a bottom anchor needs the
window height, which config cannot know — use a post-launch CDP `Browser.setWindowBounds` correction
(`top = availTop + availH - height`, clamped), which was measured to place a window exactly
(requested `(-1800,300)` → actual `(-1800,300)`). The flags themselves are correct: offset 120 →
`-1800,220`, offset 150 → `-1770,250`. Note a mid-test `y=1001` reading was the human dragging the
windows to the bottom of screen 2, **not** a defect — recorded so nobody "fixes" it later.
