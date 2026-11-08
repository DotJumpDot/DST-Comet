# Modified files (vs upstream pin 224f847d / v0.19.0)

House rule: one line per file, why it changed. New upstream pins re-apply
this list. Commits and pushes follow the AGENTS.md commit style
(`Type: summary` + `- [x]` checklist + `Verified:` paragraph).

Upstream migration round (2026-11-09, whole family: TUI 0.17.0 → 0.19.0,
engine 0.2.1-rc.2 → 0.2.2-rc.1, same round in DST-Moon and DST-Star):
`vendor/dsh-tui` re-merged onto upstream tag v0.19.0 by three-way keep-both
merge (base = pin 2957277, ours = fork, theirs = v0.19.0) — 5 conflicts
resolved keeping BOTH sides: `scripts/verify-agents-side-panel.tsx` (our
agent-fold + task-tab sections kept, upstream's new plain-`v` check appended
as §14), `src/channel/projection.ts` (our attached-context import + upstream's
new `previewIndented`/`trimLocalRows` transcript helpers), `src/components/
SubagentDashboard.tsx` (upstream's #1794 subagent channel-degradation hints
ADDED, our pinned-footer Box props kept — the hints now render in the comet
panel), `src/components/messages/AssistantToolUseMessage.tsx` (upstream's
treatment-stays-while-expanded semantics adopted, our family-tone wash rides
on top: `toolCardWash(palette, toneFamily, toolWashOf(cardToolBackground))`),
`src/settings/definitions.ts` (combined toolBackground hint). Upstream's new
modules landed whole: subagent-failure.ts, session-restore batch, /update,
onboarding login, git-worktree plugin, Agent.model selection (active on
0.2.2 engines). `patch-surface.snapshot.json` regenerated (upstream patch
rows moved). `engine/` re-forked from harness tag `dsh-v0.2.2-rc.1`: fork
versions `0.2.2-rc.1-comet.1`, peers/devDeps exact `0.2.2-rc.1` + cordis
`4.1.0`, the rc.2 `sessionProjections.stateOf` registry workaround RETIRED
(journal takes the published `teamProjectionHandle`; `Service.init` awaits
`register()`), our wake-reason plumbing, release plugin-records, human walls
and per-teammate routing ported on top; tool-agent-team imports
`ReasoningEffortId` from the `dsh-llm` root (the `/brand` subpath ships
glitched filenames in some 0.2.2 tarball extractions) and declares dsh-llm
as a peer. `plugins/dst-comet-agent-tools`: engines.dsh widened
(+0.2.2-rc.1), dsh-tools dep `0.2.2-rc.1` vendored. Global
`@deepseek-ai/dsh@0.2.2-rc.1` installed (native builds re-run with
allow-scripts; node-pty/koffi load-tested) and every banked rc.2 API fact
re-verified on the installed host: `image/offload` event,
`appendPluginRecord`, `contextPressure` projection (dsh-token-meter),
`goals` (now its own dsh-goal package, same create/edit/clear shape),
`followup`. Installed into the `dsh-tui` profile (leaf-first engine + TUI);
profile patch-yml diff vs pre-install snapshot = ZERO (caps maxMembers 100 /
maxTasks 1000 / maxActiveSubagents 100 and Constellation rows untouched).
Fresh `dstc` required.

P1/P2 asks round (2026-11-07, advice
`Advice/2026-11-06-p1p2-plan-harness-asks.md` — all four asks landed in
Constellation): #1 `browser_network_bodies` — the session now keeps LIVE
response handles (last 200, `src/browser/session.ts`) and the new tool
exports method/URL/status, redacted request headers, request+response bodies
to the owner's artifacts dir with sha256 + byte counts + a short redacted
preview (`src/browser/tools.ts`); best-effort retroactive — a body Playwright
already disposed is reported UNAVAILABLE with the reason, never faked.
#2 NEW `src/tools/dns.ts` — `dns_takeover_check`: CNAME chain walk, provider
guess from a VERSIONED fingerprint table (15 providers, can-i-take-over-xyz
derived; Azure trafficmanager/edge read claimable:false, protected), and
claimable TRUE/FALSE/UNKNOWN naming its signal; optional `fetch:true` GETs
the origin page (scope guard first on every host, 1 req/s, stops on 429) —
NO claiming, ever. #3 `evidence_scan` in `src/tools/evidence.ts` — the
13-pattern secret scan over an owner's artifacts or a root: hits redacted to
first4…last4 + sha256 + masked context line, placeholders counted separately,
one chain entry per scan (values never in output OR the chain note).
#4 `src/tools/git.ts` — `repo_commit` accepts git-mv renames (a staged
rename whose destination is inside the given paths — directory paths count —
pulls its source into the commit; staging takes the caller's paths with
`add -A` since the source is already indexed) and "Pushed." is now VERIFIED
against `git status -sb` (one retry on push failure; an unverified push
returns isError). `src/server.ts` registration + instructions,
`scripts/mcp-smoke.ts` 94 → 97 tools, `tests/unit.spec.ts` 96 → 105.
Follow-up (Constellation `3026edb`): GitHub secret scanning flagged the
SYNTHETIC Google key's shape in the new evidence_scan test (alert on
`3e58967`) — the three fake keys are now assembled at runtime from
fragments too short to match any partner pattern, and the alert is closed
in the UI as "Used in tests".

MCP-surface round (2026-11-05, advice
`Advice/2026-11-05-mcp-surface-harness-and-constellation-upgrades.md` — ALL
items A1–A6 + H1–H3 landed): Constellation — `src/tools/dupcheck.ts` (KEV
from NVD `cisaExploitAdd` + Circl sightings/bundles/affected enrichment,
bounded + degrade-never-fail, `kev_deep`), NEW `src/tools/mcp.ts`
(`mcp_tools`/`mcp_diff`/`mcp_auth_gate`: Streamable HTTP JSON+SSE, session-id
managed, snapshots on disk with descriptions NEVER in the transcript, rug-pull
diff, auth matrix capped 12 requests @ 1 req/s), `src/tools/http.ts`
(`save_body` forces the full-body disk write at any size), `src/tools/evidence.ts`
(`evidence_file` chains any on-disk artifact), `src/tools/cell.ts` (`shape`
tag + `cell_status {shape}` cross-engagement filter), `src/server.ts`
(registration + agent instructions), `scripts/mcp-test-server.mjs` (the
stub), `scripts/mcp-smoke.ts` (90 → 94 tools), `tests/unit.spec.ts` (83 → 94).
Bug_Bounty — `.dsh/skills/mcp-surface-hunt/SKILL.md` (H1 routing + gate) and
`Progress/bugcrowd/runs/LANE-TEMPLATE-mcp.md` (H2 lane page + spawn block).
Installed profile — disabled `vulnmcp` intel-server entry (H3; enable only
for a targeted prior-art pass). Lead verification round (same evening): the
live 29-check drill caught `mcp_diff` stamping write and index paths in two
`snapshotPaths()` calls that could straddle a millisecond tick — index naming
a file never written, next diff reading an empty baseline as all-added —
fixed by the lead in Constellation `9a694f3` (+ regression test); and closed
the drill's `cve_ids` gap: `dupe_check {cve_ids:[...]}` resolves KNOWN ids
via direct NVD cveId lookups (keyword search only sees the 10 newest, so the
drill's own "litellm" check missed July's KEV CVE-2026-59822) with the same
KEV/Circl enrichment, `CONSTELLATION_NVD_BASE` override for offline tests
(96/96 tests, 94 tools).

Jora post-mortem round (2026-11-05, after session 571d24fd died mid-report):
the lead's session bricked when the opencode-go upstream stopped accepting
images mid-run — every request 400'd "image input is not available on this
engine" while 5 evidence screenshots rode permanently in the surface (the
stock offload executor only reacts to locally-raised IMAGE_OFFLOAD budget
failures, never an upstream capability 400). Ops: one image/offload event
appended to the session log (5 targets, backup kept) revives it; profile
agent-team cap raised to 100 members / 1000 tasks. Code: Dsh_Tui_Comet —
`plugins/dst-comet-agent-tools/index.js` 0.2.0 (session_compact guard no
longer demands the lazy compaction service mid-turn — the one live call threw
"does not expose idle compaction"; after compaction the agent now CONTINUES
ITSELF via a synthetic follow-up; agent/request-error + compaction/
summary-error handlers offload all retained images and retry when an upstream
rejects image input; goal_set/goal_clear give the lead goal self-service
without the stock direct-human gate), `probe-inject-guard.mjs` (4 tools +
followup/goal flows), `vendor/dsh-tui/src/components/SubagentDashboard.tsx` +
`src/components/sidePanel/builtinPanels.tsx` + `src/i18n.ts` (Agents-tab `x`
bulk-folds settled rows NOW — idle teammates previously waited for the whole
task board to complete; footer shows the foldable count). Constellation —
`src/browser/tools.ts` collapseImgRuns: runs of identical bare `- img`
snapshot rows collapse to `- img ×N` (the Bugcrowd page carried 228-row runs,
~22k transcript lines across 96 snapshots in a 12.3 MB export).

DPAPI assembly-load fix (2026-10-30, lead field report post-run-11):
Constellation `16f1dfb` — `src/browser/cookies.ts` prepends
`Add-Type -AssemblyName System.Security;` to the DPAPI helper (stock
powershell.exe 5.1 -NoProfile does not auto-load it, so every
`browser_cookies_import {profile_dir}` died with "Unable to find type
[…ProtectedData]"); Windows-guarded protect→unprotect round-trip test
(82/82).

Fork isolation + crash fix (2026-10-30, user ask after creating the
DST-Moon profile): Dsh_Tui_Comet `e4c0f70` (crash: the RENDERED_ROW_CAP
compensation loop died on a sparse/mutated rows slot — "reading 'id' of
undefined" at heightOf — loop now skips undefined entries, heightOf is
defensive) and `3427b6c` (every dsh-tui-family build hard-codes the same
~/.dsh-tui regardless of dsh profile, so the DST-Moon sister fork rewrote
comet's settings/theme/ledger state: DSH_TUI_STATE_DIR override in
utils/paths.ts with a one-time legacy-dir migration, pinned to
%USERPROFILE%\.dsh-tui-comet by bin/dstc, bin/dstc.cmd and both npm shims;
resume.txt reads + session-log search roots follow; sessionMounts already
followed DATA_DIR). Installed into the profile.

Run-11 fixes (2026-10-30, run-11 advice D11–D15): Constellation `588975e`
(on top of the lead's own D10 `e9eeed7`) — `src/browser/tools.ts`
(browser_run_code_unsafe gains an in-tool timeout that returns a
distinguishable STILL_RUNNING, keeps the owner BUSY until the code settles,
and reports the late result on the next call; cookie import audited as a
handoff instead of scope-asserted, so a parent-domain cookie no longer
forces a scope widening), `src/redact.ts` (fill/type/insertText/setPassword
argument lists and "filling … with" call-log shapes masked at the
errorResult boundary — Playwright errors echoed a lane password via a
hidden-duplicate input), `src/tools/dupcheck.ts` (dupe_check queries
keywords independently and merges by CVE id — NVD ANDs a joined string and
reported 0 where "zendesk" alone returns 15; per-keyword counts + dropped-
keyword warning + 0-is-UNCONFIRMED note), `src/browser/cookies.ts` (locked
Cookies DB → EBUSY/EPERM mapped to close-Chrome/use-live-export guidance),
tests 79→81.

D9 fix (2026-10-30, run-10 advice): Constellation `ecf22af` — `src/tools/
http.ts` (+ tests, 76→78): JSON array/scalar bodies were encoded through an
object-only gate and reached servers as `[object Object]` text/plain (a
batched GraphQL cell_run read byte-identical 500s on all three legs); both
transports now encode absent | raw string verbatim | everything-else JSON
with the content-type auto-set on the same non-string gate, and the new
tests assert on the bytes a mock echo server received. The advice's §5
runner note is documented in Bug_Bounty AGENTS.md §5 (taskkill, never
Stop-Process).

Session/workspace permanent history removal (2026-10-30, user ask):
`vendor/dsh-tui/src/screens/SessionSupervisor.tsx` (Ctrl+D delete enabled
for the DSH backend — the channel plumbing always supported it, only the
key gate hid it; hint updated; bulk-removal confirm bar), `src/screens/
sessionSupervisor/model.ts` (menu action `remove-history` for history-only
unregistered rows), `src/screens/sessionSupervisor/useSessionSupervisor.ts`
(deleteHistoryGroup — permanently deletes every session behind one
history-only row via the guarded channel path, occupancy-checked, kept
sessions counted), `src/i18n.ts` (en+zh keys).

Run-9 fixes (both advice files, 2026-10-29): `plugins/dst-comet-agent-tools/
index.js` + `probe-inject-guard.mjs` (commit `07c24d8` — context_status died
with `tokenMeter.contextPressure is not a function` because the installed
dsh host 0.2.1-rc.2 ships TokenMeter with `measure()` only; the pressure
state lives in the registered `contextPressure` session projection, which is
exactly what the newer method wraps — the tool now prefers the method and
falls back to `sessionProjections.stateOf(session, 'contextPressure')`,
failing loudly when neither exists; the probe's default fixture mirrors the
real rc.2 host so it can never again stay green while production breaks).
Constellation-MCP run-9 patch `98c8cc6`: `src/tools/http.ts` (redirect hops
followed ONE at a time with a scope.assert per hop — out-of-scope hop =
audited DENY, never a quiet follow; cross-host hops drop Authorization and
rebuild cookies per-host in the jar + download transports (NOT the browser
transport — D8, see the verification paragraph below); http_download gains
`browser:`; binary content
types never preview), `src/browser/tools.ts` (browser_navigate/browser_tabs
(new)/tab_open post-check the LANDED url — crossing clears the tab and fails
closed), `src/browser/cookies.ts` (DBSC warnings name their signal and scope
per-domain — marker without a matching bound origin is a NOTE, not doom),
`src/tools/session.ts` + `src/tools/injectlab.ts` + `src/server.ts` (proof
visits pass the rule URL through the guard), `src/browser/focus.ts` + `src/
browser/session.ts` + `src/config.ts` (post-spawn focus watchdog: armed
before every Chrome spawn, 40 ms poll, AttachThreadInput restore, matches
only our user-data-dir processes, drops out after 2 counters, logs to
focus-guard.log, CONSTELLATION_FOCUS_GUARD=0 off); tests 67 → 76.

Round-9 verification (2026-10-30, `Advice/2026-10-30-round9-verification.md`,
raw matrix in `Bug_Bounty/Progress/harness-mcp/r9-smoke/RESULTS-r9.md`): 10 of
11 claims confirmed by live call on a loopback oracle — `context_status` on the
rc.2 host, hop gating with the audited `http_request(redirect hop 1)` DENY,
fail-closed `browser_navigate`/`tab_open`/`session_verify` with the tab cleared
to `about:blank`, `http_download {browser}` naming the file from the FINAL url,
binary suppression on both transports, all four DBSC branches (NOTE on
no-match, WARNING on match, INCONCLUSIVE on unreadable), and the focus
watchdog measured independently of its own log (a 40 ms poll started before the
spawn: steal at 01:47:01.611, restored 01:47:01.706 ≈ 95 ms, human's own
windows never touched, still parked at the 36 px peek). **D8 open:**
`performBrowserRequest` still forwards `Authorization` across a cross-host hop
— the jar and download loops call `crossHostHopHeaders`, that loop does not, so
a token named for host A rides into host B. Scope still holds (the far host must
be in scope) so this is credential hygiene, not a scope escape, but the sentence
above is only true for two of the three transports until it is patched.

Constellation-MCP round-8 patch `1600b9b` (lead verification: 10 gap-list
tools green against the oracle; three defects, all fixed): `src/tools/
diff.ts` (D4 — a same-status non-2xx probe/miss pair with different
bodies folded to AUTHORIZATION_DENIAL because 404 pages ECHO the
requested id; a denial now requires a status difference, same-status
non-2xx is NOT_FOUND "miss on both sides", 403-vs-404 unchanged and
test-pinned; NOT_FOUND chains no evidence so the bogus-citation class
cannot recur), `src/browser/session.ts` + `src/config.ts` (D5/§5 —
parkWindow on EVERY launch path: top = availTop + availH − peekPx,
peek from CONSTELLATION_WINDOW_PEEK_PX/--window-peek-px, default 36 =
the human's measured drag, clamped 20–60, never height-derived, never
clamped on-screen, read-back + one retry), `src/tools/recipe.ts` (D6 —
recipe failure output includes the step-log tail so the ⚠ TRANSITION
line prints mid-run), tests 66 → 67.

Constellation-MCP gap-list patch `0ec1090` (the lead's
Advice/2026-10-29-round7-tooling-gap-list.md, all six items + the small
change, 80 → 90 tools, 61 → 66 tests): `src/tools/cell.ts` (new —
cell_register/run/status/ledger; cells.json + cell-runs.jsonl; verdict
tuples stored, never checkboxes; NOT_FOUND = INCONCLUSIVE enforced in
foldCellStatus; recipe cells via the extracted executeRecipe),
`src/tools/structural.ts` (new — structuralJsonDiff leaf-pair walk with
LISTED volatile suppression + the jsonpath subset), `src/tools/http.ts`
(http_extract over retained captures/body_file; body_full fix — body_file
now stores the WHOLE body, not the capped preview), `src/tools/diff.ts`
(diff_pair auto-appends a verdict-shaped evidence-chain entry),
`src/tools/evidence.ts` (appendVerdictEntry shared by diff_pair/cell_run/
drift), `src/tools/recipe.ts` (baseline recorded after every expect
resolution, never on NOT_FOUND; recipe_baseline/recipe_drift),
`src/tools/session.ts` (KeepaliveRegistry + session_keepalive/_stop,
300 s floor, measured lifetime, honest not-preventing wording),
`src/tools/report.ts` (new — report_assemble, CANDIDATE-only refusal),
`src/server.ts` wiring + instructions. Bug_Bounty Orchestra/README.md
documents the 90-tool surface (`dfa1c7a`).

Constellation-MCP round-7 patches `3c9f97e` + `7d6529a` — the three
defects in the "verified independently" section below are FIXED, plus the
placement note implemented: `src/tools/recipe.ts` (D1 — whitelisted
actions at save time, run-time re-validation of disk-loaded recipes, and
a default arm in the executor that throws into the failure/audit path; a
step missing its action can never again run nothing and report green),
`src/scope.ts` + `src/tools/scope.ts` (D2 — host:port entries are
PORT-EXACT with scheme-default resolution (443≡https, 80≡http), portless
entries stay port-agnostic, IPv6 bracket form carries its port, the
not-in-scope denial prints the requested host WITH its port),
`src/tools/diff.ts` (D3 — SOFT_ALLOW names the MISS CONTROL when no own
leg was sent and states the DATA_LEAK verdict is unavailable),
`src/browser/session.ts` (cascade x-only per the lead's measurement +
post-launch CDP setWindowBounds bottom-anchor to the monitor work area,
best-effort, skipped for minimized starts), tests 58 -> 61.

Constellation-MCP round-6 patch `000dd15` + `9b82ae8` (smoke round 6 all
green; enables the lead's next exercise): `src/tools/http.ts`
(performBrowserRequest — one request through the owner's live browser
context (context.request, real cookie state) with performRequest parity:
scope assertion, budget charge, full-body sha256, 20 KB preview, manual
redirects, no jar merge; performLeg shared routing — `browser: "<owner>"`
or true on http_request/http_replay/http_diff/diff_pair/recipe expect
legs picks the live session, otherwise the jar; captures keep their
transport), `src/tools/diff.ts` + `src/tools/recipe.ts` (legs accept
browser; expect legs documented), `src/server.ts` wiring (diff env gains
budget + sessionFor), `src/config.ts` + `src/browser/session.ts`
(CONSTELLATION_WINDOW_POSITION/--window-position pins spawned windows
with a per-owner cascade; CONSTELLATION_START_MINIMIZED/--start-minimized
starts them taskbar-only), tests 52 -> 58. Profile cordis.patch.yml
launches constellation with `--window-position -1920,100` (left monitor —
spawned Chrome never covers the fullscreen game on the main screen).

Round-6 patch **verified independently** 2026-10-29 15:52–15:58 +07 (lead smoke; matrix in
`Bug_Bounty/Progress/harness-mcp/r6-smoke/RESULTS-r6.md`) — browser-identity legs confirmed on all
five leg sites, with three follow-ups in the patch itself:

1. `src/tools/recipe.ts` — **fail-open, fix first.** An `expect` step that omits `action` is accepted by
   `fixture_recipe_set`, executes nothing, and is logged `ok:true` with no verdict line, because both
   `validateRecipe` (l.154) and the runner (`switch (step.action)`, ~l.270) switch on `step.action` and
   there is no `default:` arm. A recipe that asserts nothing reports green. Make `action` required,
   reject `undefined` in validation, and throw `unknown step action` in a `default:`.
2. `src/scope.ts` — `scope_set` accepts `host:port` entries (`127.0.0.1:8799`) and then denies the
   matching host, because the match uses the portless hostname (l.90 message shows the entry next to
   the rejection, which reads as a contradiction). Normalise at set time (strip `:port`, say so) or
   match `host:port` when supplied.
3. `src/tools/diff.ts` — the `SOFT_ALLOW` note says "different bytes than the owner" even when no `own`
   leg was supplied; branch the wording on whether `own` was provided.

Also `src/config.ts` + `src/browser/session.ts` window placement: the cascade adds `(abs(hash)%10)*30`
to **both** axes on top of the pinned `-1920,100`, but the human's target is the **bottom of screen 2**
(left monitor, origin `-1920,0`) — the y-offset walks later owners off the bottom of the monitor. The
flags themselves are correct (offset 120 → `-1800,220`). Preferred shape: x-only cascade plus a
post-launch `Browser.setWindowBounds` bottom-anchor (`top = availTop + availH - height`), measured to
place a window exactly (`(-1800,300)` honoured, `window.screenX/screenY` agreeing).

Constellation-MCP smoke round 5 patch `5a7f302`: `src/tools/recipe.ts`
(normalizeStringArray — bare-string needles accepted; evaluateVerify —
case-insensitive by default with case_sensitive opt-in + case-only hints;
the `expect` deny/allow step running http specs through diff_pair
verdictOf with shared jars/scope/budget), `src/server.ts` wiring,
tests 51 -> 52.

Constellation-MCP smoke round 4 patch `5b7c9eb`: `src/tools/recipe.ts`
(fixture_recipe_set/list/run — the §1c recipe registry + browser-driven
executor with per-step owner switching, $var capture interpolation, run
audit; 77 -> 80 tools), `src/browser/tools.ts` (upload failure dump
self-interprets the signed-out surface; snapshotOf retries a trivial
unhydrated-SPA frame once after a settle wait), `src/tools/injectlab.ts`
(canary-set-without-fixture wording).

Constellation-MCP smoke round 3 patch (50/50 tests): `src/browser/tools.ts`
(assessUploadText/assessUpload — browser_upload reports whether the PRODUCT
accepted the file, with a signed-out warning; the uploads.jsonl record
gains accepted/signedOut), `src/tools/session.ts` (verifySessionOnce
exported for reuse), `src/tools/injectlab.ts` (campaigns persist to
rootDir/injectlab/*.json; per-variant session gate via the proof rule;
skipped(session) runs excluded from the hit-rate; resumable re-runs),
`src/server.ts` wiring.

Constellation-MCP smoke round 2 patch `db0b1e5`: `src/browser/session.ts`
(quiet windows — --hide-crash-restore-bubble/--no-first-run/--no-default-
browser-check + Preferences exit_type=Normal and password manager off on
every launch), `src/browser/tools.ts` (browser_upload: CDP file-chooser
interception armed before the trigger + disarm in finally, trigger_x/y
coordinate fallback, failure dumps visible menu texts; browser_set_files
same interception; describeErrorChain JSON-serializes non-Error throwables;
scope-violations wording), `src/tools/budget.ts` + `src/server.ts`
(budgets.json persistence), tests 45 -> 48.

Constellation-MCP smoke patch `0900290` (lead smoke round, 10/13 live-verified):
`src/browser/tools.ts` (evidence_capture actually appends the chain — the
call had silently no-oped; tab-index spelled out in new-tab responses),
`src/tools/oob.ts` (CONSTELLATION_CLOUDFLARED binary path + both error
paths name it), `src/tools/fixture.ts` (forge strips a caller-provided
extension; public config field), `src/tools/http.ts` (http_replay without
capture_id returns the latest id), + chain regression test (46/46).

## 2026-10-29 (latest) — reading history while streaming: RENDERED_ROW_CAP head-slide fix

| File | Why |
|---|---|
| `src/components/MessageList.tsx` | user report "the thing I want to read goes up every time the model emits a new line": every row appended past the 120-row RENDERED_ROW_CAP drops one row off the head of the rendered window — content above the reader shrinks, scrollTop stays, so the whole screen slides up; the index shift also broke the anchor correction's id-at-index check. The layout effect now compensates the dropped rows' height via anchorBy (skipped when sticky — the tail pin doesn't move). Repro-verified: marker lost 26-38/40 samples before, 0 after (wheel path 0-3 rows one-time settle from estimate-height boundary rows) |
| `scripts/repro-scroll-drift.tsx` (new) + `scripts/run-verify-build.mjs` + `package.json` | gate `verify:scroll-drift`: PgUp and wheel paths scroll to mid-history, 4 s of tail streaming (text growth + row appends), marker's screen row sampled continuously — never lost, settle ≤3 |

## 2026-10-29 (later still) — session-mount pid-reuse recovery

| File | Why |
|---|---|
| `src/sessionMounts.ts` | installable one-shot stale-holder evidence (pid → current bearer's start time); `holderRecordAlive` (pidAlive + evidence) drives the claim's conflict derivation AND the write-path prune — a recycled pid (2026-10-29 incident: "held by pid 22776" = a conhost that inherited a dead TUI's pid) no longer blocks a session forever |
| `src/dsh-adapter/channel/session-resume.ts` | on an occupied refusal, one PowerShell bearer-start-time query (refusal path only, never per render); provable reuse → witnessed re-claim recovers the session + "stale mount record cleared" toast; otherwise the original occupied toast |
| `src/i18n.ts` | key `resume-session-occupied-recovered` (zh + en) |
| `scripts/verify-session-mount-stale.ts` (new) + `scripts/run-verify-build.mjs` + `package.json` | gate pinning the witness predicate (orphan / same-process / predating bearer / unrelated pid / cleared) |

## 2026-10-29 (later) — run-8 proposals: fixture/diff/session/injectlab primitives (Constellation 59 → 77 tools)

| File | Why |
|---|---|
| `Advice/2026-10-29-run7-new-mcp-proposals.md` | (untracked, live-run notes) status header: §1a/1b/2/3/4/5-shape/6/7 built inside Constellation; §1c (per-product recipe registry), the guarded_proxy MITM, evidence_map_to_report, scanner/auto-submission/report-prose honestly NOT built |

Constellation-MCP (own repo) commit `8ef07be` — no new MCP project: the
primitives live inside the one audited surface. `src/tools/fixture.ts`
(fixture_publish/hits/forge/list: shared cloudflared tunnel via an OobStore
route hook; canary_seen scoring; pure-Node OOXML zip writer + PDF 1.4
generator), `src/tools/diff.ts` (diff_pair verdict matrix + firstJsonDiff),
`src/tools/session.ts` (session_verify/watch/status/proof_set with
per-site must_contain/must_not_contain rules; the account-chooser trap
fails by design), `src/tools/evidence.ts` (hash-chained append-only log +
verify), `src/tools/dupcheck.ts` (NVD keyword search + advisory-id
extraction), `src/tools/injectlab.ts` (six mechanical framings, one send
per variant, artifact-based compliance), `src/tools/http.ts` (http_replay
capture ring + verbatim-override replay; bodies >20 KB saved whole),
`src/tools/oob.ts` (route hook for /f/ content), `src/browser/session.ts`
(networkObserver + scopeViolations, wired for launch AND CDP attach),
`src/browser/tools.ts` (attach installs the scope observer;
browser_scope_violations; map warning; evidence_capture chains),
`src/server.ts` (wiring + instructions). Smoke 59 → 77 tools; unit suite
38 → 45.

## 2026-10-29 — run-7 asks: plugin-record releases, inject-free context tools, external-profile cookies, CDP attach

| File | Why |
|---|---|
| `engine/agent-team/src/types.ts` | `team/member/released` moves OUT of the SessionEventMap augmentation into a `PluginRecordMap` augmentation (`plugin:agent-team/member-released`) — the release type is outside the released event catalog, and the plugin-record envelope's `ignorable` marker is the only sanctioned way an out-of-repo type coexists with harnesses that don't know it (run-6 handoff sessions refused to continue on the plain event; run-7 blocking bug) |
| `engine/agent-team/src/journal.ts` | `appendReleased` writes through `appendPluginRecord` (ignorable envelope, retained-and-skipped by unknown readers); `commitReasonOf` keeps wake reasons for the two catalog event types |
| `engine/agent-team/src/roster.ts` | release path calls `appendReleased` |
| `engine/agent-team/src/projection.ts` | the fold applies BOTH release spellings — the plugin record (new writes) and the legacy `team/member/released` event (repaired logs) — sharing one roster-removal transition; malformed plugin records are skipped (upstream's action-cards pattern), legacy events keep their strict failure semantics |
| `engine/tool-agent-team/src/human-tasks.ts` | run-7 P1-5: `dedupeKey` on tasks + `openTaskByDedupeKey` (15-min window, per-team) so the Lead and the lane raising the same wall 19 s apart return ONE ask; `edit` rewrites title/steps/doneWhen of an open wall (the baked-in tunnel-URL case) |
| `engine/tool-agent-team/src/index.ts` | `human_task_create`: parking defaults are role-aware (teammate parks itself, the Lead does NOT park itself — the coordinator lost its tools in run 7), `dedupe_key` early-returns the open wall; new `human_task_update` tool edits an open wall and refreshes the board mirror via task `edit`; `session_compact`-style `{reason}` recording on the plugin side |
| `engine/tool-agent-team/tests/{tool-agent-team,release-projection,human-tasks}.spec.ts` | role-aware park defaults pinned (Lead unparked by default, explicit park:true parks), mirror lookup by board_task_id, 5-test release-persistence suite (plugin record commits ignorable + admissible, applies to the roster, repaired legacy events apply, duplicates/malformed skip, other-team records ignored), dedupe + edit unit tests |
| `engine/scripts/repair-released-events.mjs` | frame-surgical repairer for logs stranded by the old event: rewrites stored `team/member/released` lines to carry `"ignorable":true` (type/seq/time/data byte-identical), only touched frames re-encoded, `.pre-repair.bak` backup + full round-trip verification before rename; ran on the 4 affected Bug_Bounty sessions (79 events) |
| `engine/scripts/verify-log-admission.mjs` | checks a log against the exact persistence admission gate (KNOWN_SESSION_EVENT_TYPES.has(type) OR ignorable) — the repaired logs read ADMISSIBLE, the backups still refuse at seq 194 |
| `engine/scripts/inspect-session-log.mjs` | read-only jsonl.zstd inspector (ported frame scanner) used to locate the stranded events |
| `plugins/dst-comet-agent-tools/index.js` | run-7 P0-4 (third fix, definitive): every service read goes through cordis's inject-free `ctx.get(name)` — property access on the agent context throws `cannot get property "tokenMeter" without inject`; `session_compact` gains `{reason}` |
| `plugins/dst-comet-agent-tools/probe-inject-guard.mjs` | probe that reproduces the cordis inject guard with a Proxy (property access throws, get() resolves) and drives both tool executes through it; also pins the degraded no-service errors |
| `Advice/2026-10-29-run7-harness-and-mcp-improvements.md` | (untracked, live-run notes) status header: all 16 items addressed + the session-continue repair |

Constellation-MCP (own repo) run-7 — 48 to 59 tools (mcp-smoke asserts
the exact list), 38/38 unit tests: `src/browser/cookies.ts` (external
profile import: DPAPI + AES-GCM v10/v11, sha256(host_key) prefix strip, v20
and DBSC reported; both-direction host-only domain matching — the pinned
google.com/accounts.google.com regression), `src/browser/session.ts`
(attach over CDP with disconnect-only close, no-automation-flag launch
opts, heldLeases for reset safety), `src/browser/registry.ts`
(attachFor/launchFor, caller-only resetAll with lease refusal,
runningProfileDirs process scan), `src/browser/tools.ts` (export
`domains:[]`, import `profile_dir`, browser_attach/browser_launch/
browser_clipboard/browser_paste/browser_upload, evidence_capture, reset
caller-only, map process state, budget spend hooks, DBSC export warning,
DOM-text snapshot fallback), `src/tools/budget.ts` (enforced caps +
budget_raise), `src/tools/secrets.ts` (secrets_patch under a per-secret
lock, JSON keys in masked secrets_get), `src/tools/git.ts` (verbatim path
pre-validation before staging), `src/tools/oob.ts` (cloudflared quick
tunnels + oob_close + exposure warnings), `src/tools/mail.ts`
(mail_diagnose cross-folder verdict), `src/browser/page-dom.ts` (minimal
page-side DOM ambient), `src/redact.ts` (Array.isArray guard, real-function
password probe).

## 2026-10-28 — run-5 asks: cross-provider spawn, real errors, per-card fold, live compaction tools

| File | Why |
|---|---|
| `engine/tool-agent-team/src/index.ts` | `spawn_teammate` gains `provider` — cross-provider consultants spawn as durable teammates (route rides `agentOptions.provider`; the subagent backend stays `spawn`/`fork`); team policy tells members to use `context_status`/`session_compact` (run-5 §3/§7) |
| `engine/agent-team/src/session-message.ts` | `latestTurnFailure` extracts the newest `turn/end` error (message + code, 300-char cap) from a persisted session suffix |
| `engine/agent-team/src/roster.ts` | `checkpointInitialPrompt` + restart reconcile name the child session's real failure instead of the bare "not durably accepted" (run-5 §3) |
| `engine/tool-agent-team/tests/tool-agent-team.spec.ts` | provider threading test + `latestTurnFailure` test; schema key list gains `provider` |
| `plugins/dst-comet-agent-tools/index.js` | run-5 §7 had TWO activation bugs: (1) the `compaction`/`tokenMeter` inject sat "pending (waiting for service)" forever because `compaction` mounts lazily — no agent ever saw the tools; (2) those services live in each session's preset isolate realm, so a host-realm `ctx.compaction` stays undefined even after the inject fix. Tools now register per-agent on `agent.ctx` at `agent/created` (the tool-agent-team scaffold), so every lookup happens in the agent's own realm |
| `vendor/dsh-tui/src/components/sidePanel/builtinPanels.tsx` | Agents-tab auto-fold is PER-CARD with per-id timers — the old session-wide "nobody is running" gate let the Mother's constant running state keep every dead card visible all run (run-5 §2); failed members fold like settled rows |
| `vendor/dsh-tui/src/dsh-adapter/subagents.ts` | `settleIdle`/`resumeRunning`: a row born `running` whose child never emits an end edge (idle continuable child, released/drained lane) settles to `unknown` on the registry's authority and resurrects when the child runs again — the "Other subagents never clear" root cause (user follow-up to run-5 §2: registry presence kept rows `running` forever, and the fold skips running rows) |
| `vendor/dsh-tui/src/dsh-adapter/channel/subagent-projection.ts` | `onAgentStatus` seam on the session projection + facade delegation (routes like onStart/onEnd) |
| `vendor/dsh-tui/src/dsh-adapter/channel/binding-events.ts` | subscribes host `agent/status` (and settles on `agent/disposed`) → forwards to the projection; optional-typed for older stub channels |
| `vendor/dsh-tui/scripts/verify-subagent-idle-settle.ts` | store-level gate: idle settle freezes duration, resume re-ticks it, terminal outcomes are immutable, a late end edge still lands, no-ops for unknown ids |
| `vendor/dsh-tui/scripts/verify-agents-side-panel.tsx` | pins "show cleared" so the gate's settled fixture cards stay assertable under the per-card fold |
| `Advice/2026-10-27-bug-bounty-run5-*.md` | (untracked, live-run notes) status headers: §1/§2/§3/§6/§7/§9 addressed, §4/§8/§10/§11/§12 documented, §5 recorded |

Constellation-MCP (own repo) run-5: `src/redact.ts` (tool-error secret
redaction §1 + snapshot password masking §6), `errorResult` redaction,
`snapshotOf` masks `input[type=password]` values, `mail_search` falls back to
Spam/Trash with folder-tagged hits and `mail_get` takes `folder` (§9);
34/34 tests + smoke (48 tools).

## 2026-10-27 — run-4 asks: visible wall reply, Agents-tab wall, delegated outcome

| File | Why |
|---|---|
| `engine/agent-team/src/task-board.ts` | `complete` accepts an UNOWNED task from the Lead (pending or in_progress) — released lanes leave tasks behind and the Lead had to claim-then-complete each one (run-4 §8b) |
| `engine/agent-team/src/index.ts` | `message` wake reasons carry `sender: ≤140-char preview` of the first text block (`messagePreview`) — the Mother had to snapshot just to learn what moved (run-4 §8i) |
| `engine/tool-agent-team/src/human-tasks.ts` | `HumanTaskOutcome` gains `delegated` (run-4 §8c) |
| `engine/tool-agent-team/src/index.ts` | resolve enum/view schema + `delegated`; the delegated wake text hands the RULING to the agent ("record the ruling was yours"), distinct from done |
| `engine/tool-agent-team/tests/tool-agent-team.spec.ts` | delegated end-to-end test (wake text + list status) — 22/22 |
| `src/channel/attached-context-record.ts` (new) | durable replay of the `⧉ carried` echo from a sent message's own `<attached-context>` blocks (live + restart identical; the bubble never shows the blocks — firstTextOf keeps only the typed text, so nothing said the context rode along) |
| `src/adapter/ports/channel-view.ts` | `AttachedContextEcho` type + `ChatRow.attachedContexts` |
| `src/channel/projection.ts` | user rows derive `attachedContexts` from their blocks (same seam as the selection indicator) |
| `src/components/MessageList.tsx` | user rows render the `⧉ carried (n · chars): title` line above the bubble; height signature + MemoRow threading |
| `src/components/PromptInput.tsx` | the staged-context chip strip ends with a dim `· esc cancels` hint (the carry now answers its own "how do I back out") |
| `src/components/SubagentDashboard.tsx` | `HumanWallSummary` under the task board — open wall asks show on the Agents tab where the human actually sits, with a pointer to the `!` panel (user ask) |
| `src/components/sidePanel/HumanWallPanel.tsx` | `g delegated` key + action chip; resolve() widens to the new outcome |
| `src/dsh-adapter/team-tools.ts` | wait_agent card line keeps 100 chars of the wake detail (message previews arrive intact) |
| `src/i18n.ts` | `prompt-attached-context-hint`, `attached-context-echo`, `human-wall-resolve-delegated`, `human-wall-action-delegated`, `agents-human-wall-title/-hint`; `human-wall-attached`/`-hint` reworded (carry + Esc) |
| `scripts/verify-attached-context.tsx` | C4 updated for the trailing hint cell + C4b hint-always check |
| `scripts/verify-attached-context-echo.tsx` (new) | parser + projector harness gate for the carried echo (live/replay/absent) |

## 2026-10-27 — run-3 post-mortem: Human wall panel, instant steer, release_teammate, owner info tabs

| File | Why |
|---|---|
| `engine/agent-team/src/types.ts` | new durable `team/member/released` event + `ReleaseTeammateRequest/Result` (the roster had no removal path — stale smoke members held 4 of 11 slots for a whole run) |
| `engine/agent-team/src/projection.ts` | applies `team/member/released` (removes the member; owned tasks degrade to unowned, historical messages keep senderName); `TeamEventType` + `isTeamEvent` extended |
| `engine/agent-team/src/journal.ts` | `MutableTeamEventType` widened for the released event |
| `engine/agent-team/src/roster.ts` | `release()` (Lead-only, journal-first, best-effort child drain); the `TEAM_MEMBER_LIMIT` error now lists every member with its phase and names `release_teammate` |
| `engine/agent-team/src/index.ts` | `TeamService.releaseTeammate` façade |
| `engine/tool-agent-team/src/index.ts` | (1) `wait_agent` races the caller's inbox — user input during a wait wakes it instantly (`user_input`/`inbox_message`), with a pre-check that answers already-pending steering (the user had to Esc+resend before); (2) `release_teammate` tool; (3) `human_task_create {park:false, owner}` (the Lead queues for a lane without parking herself) + a `human-meta:` JSON footer in the board mirror the TUI parses; policy text updated |
| `engine/tool-agent-team/src/human-tasks.ts` | `create` takes caller-supplied ids and a `parkMemberId` option (null = queue without parking) |
| `engine/tool-agent-team/tests/tool-agent-team.spec.ts` | fake ctx grows inbox/`ctx.on`/`releaseTeammate`; 6 new tests (inbox wake both paths, pending-steer pre-check, release threading, park:false, owner-queues-for-lane, meta footer) — 20/20 |
| `src/components/sidePanel/humanWall.ts` (new) | pure projection of `[human] …` board tasks into panel rows (steps, done_when, lane, preserve_url, park flag from the `human-meta:` footer) — session log stays the source of truth |
| `src/components/sidePanel/HumanWallPanel.tsx` (new) | the Human wall panel (`!` tab): every ask pinned with full steps + done_when, `d` done / `f` failed / `m` reply / `o` open preserved URL / `w` jump to the owning Chrome window — resolve/reply ride `channel.submit`/`attachContext` (the TUI has no direct tool seam); badge counts open asks |
| `src/utils/focusWindow.ts` (new) | activates the Chrome window whose title matches `[owner]` via PowerShell AppActivate (Constellation prefixes owner window titles) |
| `src/components/sidePanel/builtinPanels.tsx` | registers the `human` panel (order 32, icon `!`) |
| `src/tuiDisplayPrefs.ts` | `human` joins `DEFAULT_SIDE_PANEL_IDS` |
| `src/i18n.ts` | human-wall panel strings (zh+en), `tool-name-team-human-task/-lane/-snapshot/-release` |
| `scripts/verify-side-panel-registry.tsx` | EXPECTED list grows the `human` panel |
| `scripts/verify-i18n.ts` | `human-wall-resolve-*` registered in DYNAMIC_PREFIXES (runtime-composed keys) |
| `src/components/SubagentDashboard.tsx` | Doing/Finished tab chips moved from the task-board header to the panel FOOTER next to the folded-agents row (user feedback: a chip row between roster and task rows read as a stray header mid-list); task rows start directly under the roster; `TaskBoardTabChips` exported for the footer |
| `src/components/sidePanel/SidebarMascot.tsx` | sampler parameterized by target width + a LARGE 28×20-pixel render (10 text rows) — the 22×16 sample read low-pixel next to the chat column's whale girl (user ask) |
| `src/components/sidePanel/sidebarBrand.ts` | `SIDEBAR_BRAND_ROWS_LARGE` + `sidebarMascotRows(rows, width)` picks the large sprite on wide panels |
| `src/components/sidePanel/SidePanelColumn.tsx` | bottom mascot gate 42→26 cols (the old gate hid the mascot on every default-width panel — the "whalegirl disappeared" report); large sprite at ≥32 cols on tall terminals |
| `src/dsh-adapter/team-tools.ts` | compact cards for `human_task_*`, `lane_freeze/resume`, `team_snapshot`, `release_teammate` (raw JSON blobs before); `wait_agent` result line labels `user input arrived`/`peer message arrived`/`interrupted` |
| `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md` | protocol v2: standing roster 6 + burst ≤4, lane lifecycle with release, per-owner browsers + info tabs, the human-wall loop, wait/steer rules |
| `orchestra/TEAM_DESIGN_v2.md` (new) | the full v2 team design (roles, counts, who talks to whom, Lead sightlines, what shipped, what's next) |

Companion Constellation-MCP commits (same round, separate repo): cookie
handoff (`browser_cookies_export/import/list` — values stay server-side
behind a 10-min id; the transcript sees only name/domain/flags), iframe
support (`frame:` on click/type/select_option + `browser_frames_list` +
`browser_set_files` with the filechooser path), `http_download` (metadata +
sha only) + HTTP `auth {basic,bearer}` with `$secret:` values, mail fixes
(alias matched client-side against To/Delivered-To/X-Original-To/
X-Forwarded-To/subject/body because relays rewrite To:, `\All`
special-use folder detection for localized Gmail, real error strings,
`mail_get` with anchor text + manual-HEAD redirect resolution, `mail_status`,
app-password internal-space strip), owner info tabs (first tab of every owner
window: owner·job·engagement, not closable by tools, re-opened if the human
closes it, `browser_owner_info` labels it), `browser_click {force,x,y}`,
`browser_type {submit}` waits for navigation and reports navigated/no-nav.
46 tools, 27/27 unit + MCP smoke.

## 2026-10-27 — tab chips + Mother wake-up (retest round)

| File | Why |
|---|---|
| `src/components/SubagentDashboard.tsx` | the Doing/Finished tabs restyled to the house chip pattern from SubagentDetailScene (inverse active chip with status glyph, dim `│` separator) — the first cut looked like links after a stray "Tasks" label, underlined and oddly placed per user feedback; no standalone label line anymore |
| `scripts/verify-agents-side-panel.tsx` | tab-row assertion settles on the task row first (the old one raced the fixture bump); label-free tab row |
| `src/i18n.ts` | dropped the now-unused `team-tasks-label` key |
| `engine/tool-agent-team/src/index.ts` | `human_task_create` by a TEAMMATE now messages the Lead ("human wall: …") — the board mirror alone only woke Lead-side waiters already waiting, so a Mother that called `wait_agent` afterwards slept through a parked lane (user-reported wake-up gap); the Lead parking itself still does not self-notify |
| `engine/tool-agent-team/tests/tool-agent-team.spec.ts` | pins both paths (lead-caller silent, teammate-caller notifies with lane in the text) |

Companion Constellation-MCP commit (same round): per-owner scope rules with
`scope_clear` (a 10-lane run no longer unions all engagements; stale rules
can be dropped instead of silently denying the next run), `browser_map
{owner}` scoping, sticky repo default for repo_status/repo_commit, and
http_diff no longer renders a blank A/B divergence line as empty.

## 2026-10-27 — task-board Doing/Finished tabs (user request)

| File | Why |
|---|---|
| `src/components/sidePanel/taskBoardTab.ts` (new) | module-level Doing/Finished tab store for the Agents-panel task section (survives panel switches; `t` toggles) |
| `src/components/SubagentDashboard.tsx` | the task board renders two clickable tabs with counts (`Doing n` / `Finished n`) instead of one ever-growing list the user could not read or clear; Doing = pending/in-progress (blocked tail included), Finished = completed (dim subject, owner tail at width ≥ 40); `t` toggles in both the overlay and panel key paths; tooltips preserved |
| `src/i18n.ts` | `team-tasks-label`, `team-tasks-tab-doing/-finished`, `team-tasks-doing/-finished-empty` replace the dead `team-tasks-title`/`team-tasks-empty` |
| `scripts/verify-agents-side-panel.tsx` | team fixture + 7 tab checks (default tab, counts, blocked tail, `t` switch, SGR click switch, empty-Finished state) |
| `src/components/messages/FinalSummaryRow.tsx` | docblock only — the summary row already paints no standing background (selection highlight aside); comment now states that contract |

## 2026-10-27 — final summary stays where it streamed (in-place, no lift)

| File | Why |
|---|---|
| `src/components/MessageList.tsx` | the settled answer is now DECORATED IN PLACE at the end of the turn (always expanded, ✓ header) instead of being relocated above the tool cards — on long turns the relocation teleported the text out of the viewport the moment streaming ended, so the user watched the summary vanish. Copy-on-write flag, no reorder |
| `scripts/verify-comet-transcript.tsx` | pins the in-place contract (summary row AFTER the tool cards, still always-expanded, still gated on tool/agent settle) |

Companion Constellation-MCP commit `a0e14ba` (smoke-audit findings): scope_set/get/audit tools registered (the guard was enforced but never armable), file://+view-source://+javascript:// navigation denied, http_request non-http(s) scheme rejection, CONSTELLATION_REQUIRE_SCOPE=1 mode, 20 KB body preview cap (sha still covers full body), http_jars {forget}, tab_open/tab_lease require an explicit owner, per-owner tab-index error text, force_action reports the final URL, mail TLS verification re-enabled, repo tools prefer DSH_WORKSPACE/DSH_SESSION_CWD/DSH_CWD.

## 2026-10-27 — run-log hardening (live orchestra feedback, 15.7k-line export)

| File | Why |
|---|---|
| `engine/tool-agent-team/src/index.ts` | `wait_agent` no longer surfaces a user Esc as `Error: wait_agent aborted: { kind: 'user' }` — TEAM_WAIT_ABORTED is caught at the tool layer and returned as `{timedOut: false, interrupted: true, message}` (steering event, not a failure); other errors still propagate |
| `engine/tool-agent-team/tests/tool-agent-team.spec.ts` | pins the graceful-abort result and that non-abort failures still throw |

Companion Constellation-MCP commit `3fc2998` (separate repo) from the same
export: `browser_run_code_unsafe` compat tool with a working Node `require`
(the team's 11 escape-hatch calls failed on upstream's VM), OOB tokens/hits
persisted across restarts (the mid-run hot-swap wiped their SSRF evidence),
OOB port-collision fallback to an ephemeral port, repo_status errors naming
the cwd they ran in, browser_map header de-duplication.

## 2026-10-27 — team-message mark fix (font-safe arrow)

| File | Why |
|---|---|
| `src/components/messages/TeamMessageBubble.tsx` | the `✉` envelope mark renders as a white blob in common Windows terminal fonts and sat tight against the sender name — replaced with the font-safe `←` glyph (U+2190), body hanging indent follows |
| `scripts/verify-team-message-bubble.tsx` | pins the `← <sender> → Lead · team message` line |

Install-state note: the Constellation MCP entry's `serverName` changed
`playwright` → `constellation` (user preference — tool names now read
`mcp__constellation__*`). Renaming mid-session hot-swaps the tool list, so
sessions started before the rename must re-list tools (fresh boots are fine).

## 2026-10-26 — mother-view clarity pass (live-run feedback)

| File | Why |
|---|---|
| `src/components/messages/AssistantToolUseMessage.tsx` | the Agent Teams `send_message` relay joins the structured card (was a generic one-line card whose click never disclosed the sent prompt): header is now `<sender> → <target>` (Lead for the team relay), `{sent: true}` counts as delivered, full text unfolds on click |
| `src/components/messages/TeamMessageBubble.tsx` | inbound peer bubbles show direction too: `✉ <sender> → Lead · team message` |
| `src/i18n.ts` | `team-lead-name` key (both languages: the engine's literal lead name) |
| `src/components/messages/FinalSummaryRow.tsx` | final summary renders ALWAYS EXPANDED (header + full Markdown body) — the answer is the deliverable, only tool cards and thinking fold |
| `src/components/MessageList.tsx` | summary call site drops the fold props; `promoteFinalSummaries` also lifts turns whose leading user row scrolled off the window (long sessions showed the answer glued under the last thinking block) |
| `src/components/messages/AssistantThinkingMessage.tsx` | settled thinking headers drop the repeated `(ctrl+o to expand)` suffix (hover/click still disclose) |
| `src/components/SubagentDashboard.tsx` | Agents-tab task rows carry a hover tooltip with the full subject when it is truncated (narrow panels) |
| `scripts/verify-comet-transcript.tsx` | pins the always-expanded summary + tool-only Ctrl+O toggle |
| `scripts/verify-team-message-bubble.tsx` | pins the `→ Lead` direction line |

Engine fork (code-only this pass, deliberately NOT installed): `engine/`
workspace forks the three Agent Teams packages per
`Advice/agent-team-hunt-run-2026-10-26.md` — see `engine/README.md`.

## 2026-10-26 — engine fork installed + Constellation-MCP (browser layer + engagement tools)

| File | Why |
|---|---|
| `engine/agent-team-profile/package.json` | sibling agent-team/tool-agent-team moved from `dependencies` (`workspace:*`, which `pnpm pack` rewrites to an unresolvable exact `0.2.1-rc.2-comet.1`) to `peerDependencies` with a literal range — the profile tarball now installs without registry lookups |

Install-state notes (outside the repo): all three engine fork packages are
live in the `dsh-tui` profile at `0.2.1-rc.2-comet.1` (`dsh plugin add` ×3,
one `allow-version` exemption for the fork); `team_snapshot`,
`human_task_*`, `lane_freeze/resume` and `spawn_teammate {model,effort}` are
registered. The old `@playwright/mcp` server entry in the profile patch was
replaced by Constellation-MCP (`C:\Code\Constellation-MCP`, serverName kept
as `playwright` so `mcp__playwright__*` prompts/skills keep working) —
per-owner browser isolation, tab leases, `browser_map`, scope guard,
mail/OTP, `http_request` cookie jars, OOB receiver, secrets, `repo_commit`.


## 2026-10-26 — one-line card hardening + tool background off (user preset)

| File | Why |
|---|---|
| `src/theme.ts` | `toolNameSearch`/`toolNameMcp` tokens in every built-in; exec green (distinct from Read cyan) |
| `src/components/messages/toolTone.ts` (new) | family mapping + family colour token + per-family card wash blended from the theme's own surface |
| `src/components/ToolUseLoader.tsx` | status dot follows the same family token (Read/Grep/Pwsh/MCP differ) |
| `src/components/messages/AssistantToolUseMessage.tsx` | Read/Grep join the one-line card mode; persistent `▸`; family colour + wash; header title flattens newlines and truncates before it can wrap (MCP code args / terminal scripts) |
| `src/components/sidePanel/PanelBar.tsx` | navigator contract: `◀ icon Title ▶` only (no tab-icon fan), count/badge on the active title |
| `src/components/sidePanel/SidePanelColumn.tsx` | brand header = 22×16 mascot beside the wordmark (one-cell gap), click cycles the mascot; 8 rows + 1 gap on tall/wide panels, text-only 2 rows + gap otherwise; host height follows |
| `src/components/sidePanel/SidePanelLayout.tsx` | divider junction rows follow `sidebarBrandRows(rows, panelColumns)` |
| `src/components/sidePanel/sidebarBrand.ts` (new) | mascot variants, width+height-aware `sidebarBrandRows`, persisted choice (`~/.dsh-tui/sidebar-logo.json`) |
| `src/components/sidePanel/SidebarMascot.tsx` (new) | whale-girl / pixel-whale sprite mode-sampled to a 22×16 logo box (compact 22×4 strip) |
| `src/components/Whale.tsx` | export `WHALE_PALETTE` for the sidebar's miniature whale |
| `src/components/SubagentDetailScene.tsx` | narrow-panel layout: one-line identity with truncation, status on its own row, compact tabs (no counts), one-line footer |
| `src/components/MessageList.tsx` | display-only final-summary lift (newest turn waits for agent idle), signature/cache keys, row render |
| `src/components/messages/FinalSummaryRow.tsx` (new) | collapsed `✓ Final summary` line; click/Ctrl+O expands to Markdown |
| `src/adapter/ports/channel-view.ts` | `ChatRow.finalSummary` display decoration (copy-on-write, never projection) |
| `src/screens/Chat.tsx` | passes `agentRunning` (turn-settled gate) to the transcript |
| `src/components/SubagentDashboard.tsx` | clears folded agents (`c` show/hide), single-line footer count, clears ignore running agents |
| `src/components/sidePanel/agentsPanelClear.ts` (new) | session-scoped fold set; show/hide flag |
| `src/components/sidePanel/builtinPanels.tsx` | auto-folds finished agents after the work settles (4s grace); wires `c` |
| `src/settings/definitions.ts` | one-line-cards hint covers Read/Grep |
| `src/i18n.ts` | final-summary, cleared-agents, and compact subagent-tab keys (zh/en) |
| `scripts/verify-side-panel-layout.tsx` | locks the new bar/brand/junction contract at 40 rows |
| `scripts/verify-side-panel-mouse.tsx` | navigator arrow contract replaces the icon-fan tests |
| `scripts/verify-side-panel-registry.tsx` | active-only bar + keyboard panel routing; Info stub gains `mcpStatus`/jobs/notifications |
| `scripts/verify-agents-side-panel.tsx` | 26-row fixture for the compact brand header; cleared-agent fold/show checks |
| `scripts/verify-tool-card-completeness.tsx` | pins `oneLineToolCards: false` (that script tests bodies) |
| `scripts/verify-comet-transcript.tsx` (new) | final-summary lift, one-line cards, tone families |
| `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md` | site-teammate cap 3 → 10 |
| `C:\Code\Bug_Bounty\AGENTS.md` §8.1 | deployed copy of the same cap change (outside this repo) |
| `~/.dsh/profiles/dsh-tui/cordis.patch.yml` | `agent-team` override `maxMembers: 11` (10 teammates + Lead; bundle said 8) |

Follow-up hardening (same pass):

| File | Why |
|---|---|
| `src/components/sidePanel/InfoPanel.tsx` | session/agent id rows survive partial fixture channels (`typeof` guard before `.slice`) |
| `src/components/messages/AssistantToolUseMessage.tsx` | SendMessage relay cards keep their preview body under one-line mode (the message + summary IS the card) |
| `scripts/verify-side-panel-resize.tsx` | frame helper derives the divider tee from `sidebarBrandRows` (brand header moved the top tee) |
| `scripts/verify-toolcard-i18n.tsx` | preview-contract scenarios + header-split check pin `oneLineToolCards: false` (fork default hides bodies by design) |
| `scripts/verify-agent-view-ui.tsx` | Chat phase closes the side panel (fork boots open; the phase pins full-width-chat + fullscreen-dashboard contracts) |
| `src/adapter/ports/channel-display.ts` + `tuiDisplayPrefs.ts` | `SidebarLogoPosition` type + normalize (mascot placement setting) |
| `src/adapter/ports/channel-ui.ts` + `adapter/channel/ui-policy.ts` | `sidebarLogoPosition` port property + `setSidebarLogoPosition` (mutate class) |
| `src/dsh-adapter/{index,channel/state,channel/preferences,plugin}.ts` | config schema, channel seed/init/setter, /settings field `dsh-tui.sidebarLogoPosition` (top/bottom, default top) |
| `src/settings/definitions.ts` | `sidebarLogoPosition` select entry (appearance, zh/en) |
| `src/components/sidePanel/{sidebarBrand,SidePanelColumn,SidePanelLayout}.tsx/.ts` | position-aware brand rows + centered bottom mascot block + junction tees follow the text-only header |
| `src/screens/Chat.tsx` | passes `channel.sidebarLogoPosition` to the layout + column |
| `scripts/verify-side-panel-layout.tsx` | bottom-placement unit + render checks (221 checks) |
| `vendor/dsh-tui/cordis.patch.yml` + `patch-surface.snapshot.json` | dropped the `tool-ralph` disable row (0.2.x runtime no longer registers the entry — the row only logged `patch: entry not found` at boot); snapshot regenerated |

One-line card hardening + background-off ask (same day):

| File | Why |
|---|---|
| `src/components/messages/AssistantToolUseMessage.tsx` | single-line titles pre-cut to `headerTextBudget` (flex truncation alone let the elapsed chip wrap onto a 2nd row — Pwsh/MCP long titles rendered 2 lines); elapsed chip `flexShrink=0` + truncate-end belt |
| `src/settings/definitions.ts` | `toolBackground` None option relabeled "None (text color only)" + hint explains the transparent row (the off-switch already existed; made it discoverable) |
| `scripts/verify-tool-tooltip-gating.tsx` | case G: settled one-line Pwsh/MCP cards with over-budget titles occupy exactly one viewport row (chip + ▸ on the header line, next row blank) |
| `scripts/verify-display-settings.tsx` | wash gate derives expected ANSI from `getTheme` + `toolCardWash` instead of frozen RGB literals (stale since the per-tool tone blend; subtle now blends read tone → 44;59;72) |

User preset: `~/.dsh-tui/settings.json` `values.toolBackground` set to `none`
so the next boot shows tone-colored names on a transparent row.

Known environment noise (not fork code): `dsh --profile dsh-tui` still logs one
`patch: entry "tool-ralph" not found` at boot. Source: the profile resolves
the fork's `@deepseek-ai/dsh-web-app` peer from the stale shared
`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-web-app@0.1.0-rc.6`, whose own
patch still disables `tool-ralph`. Harmless; refreshing that shared package
(or a future dsh CLI update) clears it.

## 2026-10-26 — model-facing context tools + desktop shortcut

- `plugins/dst-comet-agent-tools/` (new out-of-tree dsh bundle, installed in
  the profile): `context_status` (agent reads its own context usage — used
  tokens, window, %, auto-compact trigger from `tokenMeter`) and
  `session_compact` (agent-initiated compaction: schedules
  `ctx.compaction.compactNow` for the turn's end via `agent.whenIdle()` with
  a busy-retry, since compaction requires an idle agent). Vendored dep
  `@deepseek-ai/dsh-tools@0.2.1-rc.2`; `engines.dsh` gates compatibility.
  Stock DSH exposes NEITHER to the model (token meter is UI-only; compact is
  human `/compact` only).
- Desktop: `DST-Comet.lnk` (cmd /k dstc) + generated `assets/dst-comet.ico`
  (comet head+tail, mist-blue); icon also installed to `~/.dsh/icons/`.

## 2026-10-26 — comet theme + prose palette + agent-team orchestration

- `src/theme.ts`: 8 new Theme keys (method pills ×6, proseStrong,
  proseQuote) across all built-ins; new `comet` theme (soft body text,
  white bold, pink quotes); vivid-diff base inherited. Registered in
  THEME_NAMES/getTheme/themeCatalog.
- `src/themeCatalog.ts`: comet base role.
- `src/terminal-utils/markdown.ts`: HTTP-method prose coloring
  (CometStream's path-lookahead guard), curly-quote spans, theme-gated
  bold; no-op (byte-stable) for themes whose tokens equal `text`.
- `cordis.yml`: compact thresholdRatio default `0.2 → 0.45`.
- Profile: `dsh-experimental-agent-team-profile@0.2.1-rc.2` added;
  `~/.dsh-tui/theme.json` preset to `comet`.
- `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md`: reusable Mother-mode protocol
  (deployed into the Bug_Bounty workspace's AGENTS.md §8).
- Gates: 13 markdown/theme gates pass; full verify:build re-run.

## 2026-10-26 — recheck pass (bug fixes)

- `AssistantToolUseMessage.tsx`: one-line suppression now skips RUNNING cards
  (the running-elapsed line and live-output window are the only progress
  feedback; suppression also killed pending write previews mid-call).
- `InfoPanel.tsx`: MCP rows parsed by segment (`name · status · tools`) with
  exact status matching — the first cut's substring test painted
  `disconnected` green; server names are now row labels, notes render dim.
- `SidePanelColumn.tsx`: `installedTuiVersion()` memoized (it reads installed
  files; the column re-renders on every channel emission).
- Profile install flow: the tarball now lives at `dist/dst-comet.tgz`
  (persistent — the profile's `file:` dependency resolves it on future
  plugin operations); `install-fork.bat` packs with pnpm 11 + hoisted
  linker (pnpm 12 refuses bundledDependencies).
- `bin/dstc`: POSIX arg rebuild instead of eval string; `.gitattributes`
  pins LF for shell launchers.
- Gates: `typecheck` + full `verify:build` suite run clean on the fork.

## 2026-10-26 — first feature pass

| File | Why |
|---|---|
| `src/tuiDisplayPrefs.ts` | side panel opens by default (`sidePanelOpenStore` false→true) |
| `src/components/sidePanel/SidePanelColumn.tsx` | DST Comet brand header (2 rows) above the panel tab bar |
| `src/components/sidePanel/InfoPanel.tsx` | MCP section fed by `channel.mcpStatus()` |
| `src/adapter/ports/channel-ui.ts` | port: `oneLineToolCards` + `setOneLineToolCards` |
| `src/adapter/channel/ui-policy.ts` | classify the new property/setter |
| `src/dsh-adapter/channel/state.ts` | state field + initializer (default on) |
| `src/dsh-adapter/channel/preferences.ts` | `setOneLineToolCards` impl |
| `src/dsh-adapter/index.ts` | Config schema `oneLineToolCards` default true + doc |
| `src/dsh-adapter/plugin.ts` | settings schema, channel seed, apply, /settings field, settings type |
| `src/settings/definitions.ts` | `oneLineToolCards` setting entry (sorted position) |
| `src/screens/Chat.tsx` | pass `oneLineToolCards` to MessageList |
| `src/components/MessageList.tsx` | thread the prop (types, defaults, height signature) |
| `src/components/messages/TranscriptLeaves.tsx` | thread the prop to subagent tool cards |
| `src/components/messages/AssistantToolUseMessage.tsx` | one-line collapse behavior (terminal/generic, not errors/diffs) |
| `src/components/messages/AssistantThinkingMessage.tsx` | thinking header line-count stat |
| `src/i18n.ts` | keys: `thinking-lines`, `info-section-mcp` |
| `src/theme.ts` | vivid diff colors in `darkTheme` |
| `vendor/dsh-tui/pnpm-lock.yaml` | pnpm 12 specifier normalization (`workspace:*`→`workspace:^`), incidental |

## Repo scaffolding (not upstream files)

`bin/dstc.cmd`, `bin/dstc` (launchers) · `scripts/setup-vendor.sh`,
`scripts/install-fork.bat` (setup/install) · `VENDORED.md` (pins) ·
`Docs/DESIGN.md` (this design map).
