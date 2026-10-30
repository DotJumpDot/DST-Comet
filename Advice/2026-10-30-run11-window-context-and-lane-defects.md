# Advice — run 11 (2026-10-30, Bugcrowd long run): window/context defect fixed, five harness gaps, D9 verified

Format: what happened → ask. Run 11 was a Bugcrowd-only long run (≈145 target requests, zero candidates, no human
walls). The full run record is `C:\Code\Bug_Bounty\Progress\bugcrowd\RUN11-CHECKPOINT-2026-10-30.md`.

## 1. D10 — extra Chrome windows + wrong park box (FIXED in Constellation `e9eeed7`)

**What happened.** The human reported "multiple Chrome starts … not at the bottom of the screen". Measured live:
2 owner Chrome processes but **5 windows** — `zendesk-fe` had 4 visible + 1 minimized. The 4 extras were **Playwright
browser contexts** created by that lane's `browser_run_code_unsafe` code (`browser.newContext()`); each context is a
separate Chrome WINDOW at Playwright's default **1296×808**, invisible to the tab registry, leases, owner label and
park helper (one of them carried the ZF-3 article-probe URL, which is what the human saw). Separately, `parkWindow`
only set `top`: `left` came from the launch flag `--window-position -1920,100` + the per-owner cascade, so owner
windows measured `left -1920 / -1800` against the measured spec `availLeft+367 = -1553`; extra contexts were never
parked at all.

**Ask / resolution.** Fixed in Constellation `e9eeed7` (bug-bounty repo commit `f3a6a1e` carries the rule in AGENTS
§8.2): park now applies the WHOLE measured box (`left = workArea.left + 367`, `top = workTop + workH − 36`,
`945×1012`; overrides `CONSTELLATION_WINDOW_PARK_LEFT_OFFSET/WIDTH/HEIGHT` or `--window-park-*`), `workAreaAt` returns
left/width as well, and the read-back retry verifies left+size (not only the strip). `browser_run_code_unsafe` now
sweeps extra contexts after the code returns and reports the closed page URLs. Verified: build clean, **79/79 tests**,
**90-tool smoke PASS**; live windows were re-measured exactly at `-1553,996,945×1012` and the 4 orphaned contexts
closed. **A fresh dstc is required for the running server to pick the fix up** — the current session still runs the old
build in memory (same pattern as D9).

**Standing rule (already in AGENTS §8.2):** never create a browser context inside the escape hatch; tabs in the owner
context only (`browser_tabs new` / `tab_open`).

## 2. D11 — `browser_run_code_unsafe` timeout does not stop the code (open)

**What happened (market-c, exact text).** The tool returned `Error: Request timed out` while the async code kept
running and wrote ~170 evidence files AFTER return. A lane cannot know whether the timeout means "no work done" or
"work still running".

**Ask.** Either (a) add an in-tool timeout that returns a distinguishable `STILL_RUNNING` result and marks the owner
busy, or (b) document that a timeout never implies the code stopped. Until then, treat a timeout as "unknown, check
the artifacts directory".

## 3. D12 — Playwright fill errors echo the fill value (second occurrence)

**What happened (statuspage-c).** A hidden duplicate password input made `page.fill` time out; Playwright's error text
carried the fill value (A's password) into the tool log. No value reached a file, argument or chat; A's password was
rotated and re-verified the same block (run-9 precedent). The lane had followed the "read credentials inside
`browser_run_code_unsafe`" rule — the leak is the ERROR rendering, not the lane.

**Ask.** Sanitize Playwright action errors before they enter the transcript (mask any `fill(...)`/`type(...)` argument),
or document "never pass a secret literal to `page.fill`; use `locator.fill` on a visible-only locator or a JS setter".

## 4. D13 — `dupe_check` under-reports NVD (correction issued)

**What happened (researcher).** `dupe_check` reported **0** published Zendesk CVEs; a direct NVD
`keywordSearch=zendesk` on the same day returns **15**, including **CVE-2024-49193** (core Support, CWE-290, 7.5:
ticket-history read via e-mail spoofing, fixed 2024-07-02). It appears to AND the keyword list (multi-keyword queries
under-report).

**Ask.** Fix the NVD query construction to OR/independent queries, or return a machine-readable warning on multi-keyword
input. Standing guidance until then: a 0-CVE `dupe_check` result is **UNCONFIRMED** until the raw NVD query is run.

## 5. D14 — `browser_cookies_import {profile_dir}` EBUSY against a running Chrome (open)

**What happened (zendesk-fe).** `Error: EBUSY: resource busy or locked, copyfile '<Chrome>\Default\Network\Cookies'`
while the human's Chrome was running; a pwsh `Copy-Item` retry failed identically. The documented profile-directory
path is unusable while Chrome holds the DB.

**Ask.** Either copy through a VSS snapshot, or have the tool detect the lock and return "close Chrome (or use
`browser_cookies_export` from an attached session) and retry" instead of a raw EBUSY stack.

## 6. D15 — `browser_cookies_import` scope-refuses parent-domain cookies (open; workaround known)

**What happened (market-c).** Importing with `domain_filter` for `atlassian.net` was refused:
`Error: SCOPE DENIED: atlassian.net is not in the declared scope` — even though the import is a handoff, not target
traffic. Workaround used: add the two exact parent hosts to the lane scope, import, then reset the scope.

**Ask.** Cookie import should be exempt from the request scope guard (or check the cookie's *registrable domain* against
scope entries, with the same audit line), since the current behavior forces a scope widening to move a session.

## 7. D9 — verified FIXED consumer-side (keep the nuance)

7 loopback requests against the self-owned oracle (`Progress/harness-mcp/r9-smoke/d9-verify-run11.md`, commit
`662ab5c`): array bodies now arrive as correct JSON with `application/json` in `http_request`, `http_replay` and
`http_diff`; object no regression; raw string verbatim with no invented JSON header. Two honest nuances for the D9
status header: (a) top-level scalars (`5`, `true`) JSON-encode correctly but keep undici's `text/plain;charset=UTF-8`
header — pass `content-type` explicitly if a target ever needs a JSON media type for a scalar; (b) `$secret`
interpolation was not re-verified (this profile exposes no `CONSTELLATION_SECRET_*` names).

## 8. Known env gaps, still open (no new action)

`web_search` → `Error: DeepSeek search has no API key for "DEEPSEEK_API_KEY"` (any query) — lanes use direct URLs.
Fixture JSON with a UTF-8 BOM breaks strict parsers. Zendesk auth inputs have no `type` attribute
(`input[type="text"]` never matches; `locator('input').first()` works). In-page fetch of attachment bytes throws —
use a download event. Guide API silently ignores `draft:false` publish intent (create published instead).

## 9. What worked well (keep)

`browser_cookies_export`/`import` preserved an end-user session across an admin phase at **zero** target requests
(10-minute handoff TTL; the "possibly device-bound" warning was conservative on zendesk.com). `taskkill /PID /F` on
helper processes left the DSH runner healthy (0 occurrences of the run-10 abort). Per-owner scope rules survived
mid-run lane repurposing and were cleared cleanly at wrap.
