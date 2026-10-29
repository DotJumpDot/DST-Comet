# Round-8 verification + two real defects (2026-10-29)

**Author:** `lead`. **Build under test:** Constellation `0ec1090` (80 → 90 tools) + DST-Comet TUI `4f1e704`
(pid-reuse recovery). **Method:** every claim re-tested against a self-owned local oracle
(`Bug_Bounty/Progress/harness-mcp/r6-smoke/fixture-oracle.js`, extended this round with `/obj`, `/big`
and a `&open=1` broken-boundary switch), never against a third party. Cross-reference:
`Bug_Bounty/Progress/harness-mcp/r6-smoke/RESULTS-r6.md` / `RESULTS-r7.md`.

> **Status (2026-10-29, later) — ALL THREE DEFECTS FIXED (Constellation `1600b9b`, 67/67 tests, smoke 90):**
> - **D4 FIXED** — `verdictOf` now requires a STATUS difference for a denial: a same-status non-2xx
>   pair is NOT_FOUND ("miss on both sides — error pages echo the requested id, so the bytes differ by
>   construction"). `r8-blind` (404/404 echo pair) → NOT_FOUND → INCONCLUSIVE, no evidence chained (the
>   bogus entry-#4 class cannot recur); `r8-held` (403 vs 404) still AUTHORIZATION_DENIAL, pinned by
>   test. Documented honest cost: same-status 403/403 with genuinely different denial reasons also
>   reads NOT_FOUND — conservative by design; reshape the control so the statuses diverge.
> - **D5 FIXED as the §5 feature** — `parkWindow` runs on EVERY launch path (minimized starts
>   excepted): top = availTop + availH − peekPx with the peek from `CONSTELLATION_WINDOW_PEEK_PX` /
>   `--window-peek-px` (default **36** = the human's measured drag; clamped to the 20–60 clickable
>   band), NEVER derived from window height (the stale-43px-box race is structurally gone), never
>   clamped fully on-screen, bounds read back and the park retried once for DPI/DIP rounding —
>   verification by measurement, exactly per §5. The parked demo window is untouched (the human's to
>   close).
> - **D6 FIXED** — `fixture_recipe_run`'s failure output now carries the tail of the step log, so the
>   ⚠ TRANSITION DENY→ALLOW line prints mid-run even when the run then fails the assertion.
> - Scope note answered: the 90-tool inventory is asserted by the exact-list mcp-smoke gate
>   (`MCP SMOKE PASS (90 tools registered)`), which the lead's run also confirmed.

**Headline: the new tooling is real and mostly excellent — but the cell ledger can still report a
false NEGATIVE, and the bottom-anchor placement is wrong on one launch path.**

---

## 1. Verified green (with the evidence that matters)

| item | verification |
|---|---|
| `cell_register` / `cell_run` / `cell_status` / `cell_ledger` | 4 cells registered and run; statuses `NEGATIVE` / `CANDIDATE` / `INCONCLUSIVE` / `NEVER TESTED` all exercised; ledger prints the full verdict tuple per cell (statuses, body shas, deciding field) plus the evidence-chain citation |
| `diff_pair` / `cell_run` auto-evidence | every non-`NOT_FOUND` verdict cited itself: chain #2 (held), #3 (broken), #4 (the bogus one — see D4). A `NOT_FOUND` run recorded **no** evidence and said so: *"NOT_FOUND records no evidence — it proves nothing"* — exactly right |
| `http_diff {structural:true}` | `role: member → owner` and `nested.items[0].role: member → owner`, with `csrf`/`ts`/`uuid` **listed** as suppressed and the reason given, instead of "the minified line differs" |
| `body_file` fix | request `/big` → on-disk file is **31354 bytes**, its sha256 **equals the response body sha**, and the sentinel that exists only at the very end (`TAIL-MARKER-R8`) is present. The old "saved whole to disk" claim is now true, proven by hash equality rather than by file size |
| `http_extract` | `.sentinel` → `TAIL-MARKER-R8`; `.rows[*].i` → 30 values; `read_from` reported each time. No body entered the transcript |
| `report_assemble` | CANDIDATE cell → skeleton with repro table, chain entry + hash, VRT placeholder, `<!-- HUMAN -->` prose markers. Mixed set with a NEGATIVE cell → **refused by name**: *"r8-held is NEGATIVE … only CANDIDATE cells belong in a report"* |
| `recipe_baseline` / `recipe_drift` | run 1 recorded `AUTHORIZATION_DENIAL … expect deny HELD`; run 2 (boundary opened) recorded `SOFT_ALLOW … expect deny BROKE`; `recipe_drift` → `DENY→ALLOW … ⚠ OPENING — candidate` with both timestamps. A `NOT_FOUND` run created **no** baseline (anti-poison rule holds) |
| `session_keepalive` | `every_s: 300` from 11:29:10Z; tick fired at **11:34:11.337Z**, logged to `session-keepalive.jsonl` as `SIGNED_IN` against the proof rule; `session_status` reports the registry entry, tick count and lifetime. (A "0 tick(s)" reading at 11:32Z was correct — the first tick was still 84 s away, not a bug) |
| TUI `4f1e704` | gate exists and passes: `npm run verify:session-mount-stale` → `verify-session-mount-stale: OK`, exit 0; commit touches `session-resume.ts`, `sessionMounts.ts`, a new `verify-session-mount-stale.ts` and wires it into `run-verify-build.mjs` |

Honest scope note: I exercised the behaviour of the new tools; I did not independently enumerate the
90-tool inventory (no listing surface is exposed to an agent), so that specific number remains the
implementer's claim plus the smoke assertion.

## 2. D4 — HIGH, false green: a same-status 4xx pair folds to `NEGATIVE`

Two cells, same fixture, differ only in whether the two probe URLs are different:

```
r8-blind           probe /secret?id=zzz-unknown-a   -> 404 body "NOTFOUND object=zzz-unknown-a"
                   miss  /secret?id=zzz-unknown-b   -> 404 body "NOTFOUND object=zzz-unknown-b"
result: AUTHORIZATION_DENIAL (deciding: body) — status NEGATIVE, evidence chain #4

r8-blind-identical probe /secret?id=zzz-unknown-a   -> 404
                   miss  /secret?id=zzz-unknown-a   -> 404 (byte-identical)
result: NOT_FOUND (deciding: none) — status INCONCLUSIVE, no evidence
```

**Nothing was tested in `r8-blind`** — both sides missed the lookup. The bodies differ only because the
404 page **echoes the requested id**, and the requested ids necessarily differ. `verdictOf` reads that
as an authorization decision, so a blind cell becomes `NEGATIVE` — "tested, no bug" — which is precisely
the failure mode the ledger was built to close, reproduced inside the ledger.

Why this matters in real work: an id-echoing 4xx body is the norm ("Item 123 not found", 403 pages naming
the resource). Any IDOR cell shaped `?id=<victim>` vs `?id=<random>` against such a server produces a
synthetic `AUTHORIZATION_DENIAL`, and with `expect: deny` folds to `NEGATIVE`. The evidence chain then
holds a citation for a verdict that proved nothing (entry #4 here).

**Suggested fix (narrow, safe).** In `verdictOf`, a "real decision" should require either (a) a status
difference, or (b) probe 2xx with differing bytes. A same-status pair where both are non-2xx is a
**miss on both sides** → `NOT_FOUND`, regardless of body. Optionally strengthen further by normalising
the request's own id out of each body before comparing (replace the probe's id in the probe body and the
miss's id in the miss body with a placeholder) so echo noise never registers as a difference. Keep the
status-difference path untouched — `r8-held` (403 vs 404) still correctly returns
`AUTHORIZATION_DENIAL`, and that is the healthy shape.

## 3. D5 — MEDIUM, placement: inconsistent across launch paths, and the peek comes from a stale box

> **Corrected 2026-10-29 18:44 after the human's screenshots.** Parking the window *below* the bottom edge
> is the **preference**, not a bug (see §5). The defect is that it happens by accident, with the wrong peek,
> and only on some launch paths. An earlier draft of this section said "never off-screen" — that was wrong.

Three launch paths plus the human's own drag, same build and config:

| launch path | measured `screenY` | visible strip | what the human sees |
|---|---|---|---|
| `browser_navigate` (`smoke-r8b`) | 20 | 1012 px (full window) | full-height window at the **top** of the monitor |
| `session_keepalive` visit (`smoke-r8`) | 989 | 43 px | parked, but by 43 px — a stale box |
| `browser_launch` (`placement-demo`) | 20 | 1012 px | full-height window at the top |
| **human's own drag** (same `placement-demo`) | **996** | **36 px** | **the target** — tab strip only, bottom edge |

`989 + 43 = 1032` exactly: on the keepalive path the anchor used a **43 px** height instead of 1012, i.e.
it measured the window before it finished sizing. It landed near the target by luck of the arithmetic,
not by design.

**Fix.** One shared helper, applied on every launch path: `top = availTop + availH − peekPx`, with
`peekPx` from a config knob (`CONSTELLATION_WINDOW_PEEK_PX`, default **36**), scaled by the monitor's DPI
if the desktop is not at 100 %. Deliberately **do not** clamp the window fully on-screen — that would undo
the preference. Read the bounds back and retry once so the peek is what was asked for.

## 4. D6 — LOW: the mid-run ⚠ drift line does not print on the failing path

The claim was that a `DENY→ALLOW` opening prints a ⚠ candidate line **mid-run**. In the reproduced
opening, `fixture_recipe_run` failed at the expect step with the assertion message only; the ⚠ line
appeared later in `recipe_drift` (which is the important part and works). Cosmetic, but worth fixing
because the mid-run line is the one a lane actually sees.

## 5. Standing preference — Chrome placement (confirmed 2026-10-29 18:44 by the human's own drag)

> **Chrome windows the harness opens must be parked at the BOTTOM of screen 2 with only the tab strip
> visible** — not centred, not floating, not full-height at the top. This is the human's default, not a
> nicety.

The human demonstrated it by dragging the live window, so the spec is measured rather than guessed
(`placement-demo`, left monitor `availLeft = -1920, availTop = 0, availW = 1920, availH = 1032`):

| property | value | derivation |
|---|---|---|
| `top` | **996** | `availTop + availH − 36` |
| visible strip | **36 px** | the Chrome tab strip, clickable to bring the window up |
| `left` | **-1553** | `availLeft + 367` |
| size | **945 × 1012** | unchanged; content lives below the screen edge |
| resting state | `windowState: normal` | not minimised — the tab strip must stay visible |

Why this works for both sides: the human gets a collapsed browser that never covers their work, and the
agent is unaffected — CDP, screenshots, `http_extract` and the whole tool surface operate on the page, not
on the pixels. Clicking the tab strip restores the window when the human wants to look.

Rules:
- **Every path:** lane spawns, `session_keepalive` visits, upload-chooser interactions — one shared
  placement helper, so a window appearing at the top of the screen is a regression of this preference.
- **Do not clamp it fully on-screen.** That was the earlier (wrong) instinct; it would undo the collapse.
  Only guard that the peek stays in a sane band (~20–60 px) so the tab strip is clickable.
- **Not in scope:** the human's own Chrome — they place their own windows.
- **Verify by measurement, not by flag:** `visibleStrip = screen.availTop + screen.availHeight − window.screenY`
  (36 is correct; 1012 means it opened at the top, 43 means a stale-height anchor like D5).
  Window size churn: `screenY` from the page is the authoritative reading, the `--window-position` flag is not.

## 6. What I would fix first

**D4, before anything else.** The other two are annoyances; D4 makes the ledger lie in the exact
direction that costs a hunt — a blind cell silently counted as tested. D5 second, but it is now a
*feature* request rather than a bug: implement the confirmed bottom-park (§5) uniformly through one
helper, with the peek from config instead of a stale box. D6 third (cosmetic).

No new tooling is needed for any of the three; they are corrections inside code that already exists.

---

## 7. Round-9 re-verification (2026-10-29 18:46–18:52) — D4/D5/D6 fixed, plus a new finding on focus

Constellation `1600b9b` (67/67 tests, `MCP SMOKE PASS (90 tools registered)`). The MCP server was confirmed
to have restarted **after** the fix commit (process start 11:45:27Z vs commit 11:43:43Z), so these are
live-build results, not a stale process.

| defect | re-test | result |
|---|---|---|
| D4 | `cell_run r8-blind` (404 vs 404, ids differ) | **`NOT_FOUND … status INCONCLUSIVE`**, message cites round-8 D4, **no evidence chained** ✅ |
| D4 healthy shape | `cell_run r8-held` (403 vs 404) | `AUTHORIZATION_DENIAL … NEGATIVE`, chain #6 ✅ — untouched |
| D5 | fresh owner via `browser_navigate` | `screenY = 996`, `visibleStrip = 36` ✅ exactly the drag spec |
| D5 keepalive path | keepalive's initial visit launched the window | `screenY = 996`, `visibleStrip = 36`, `IsIconic = false` ✅ — the stale-43 px race is gone on the path that had it |
| D6 | baseline reset → stage 1 DENY → stage 2 open | the failed run now prints `[step 1] ⚠ TRANSITION DENY→ALLOW — this boundary OPENED since its last baseline: candidate (cited in the evidence chain)`; chain #7 ✅ |

One deviation, not a defect: parked `left` is the per-owner cascade (`-1770`, gap 150) rather than the
exact 367 from the human's drag — better for N windows, which line up sideways instead of stacking. The
peek is the number that matters and it matches.

### D7 — NEW: spawning steals focus; the lever is the **creation flag**, not activation calls

Measured with `GetForegroundWindow` around each spawn (foreground was the DSH TUI window, pid 1972):

| spawn | foreground after | parked? |
|---|---|---|
| normal `browser_launch` | **`[focus-a] info — no job set - Google Chrome`** | yes (peek 36) — but **focus stolen** |
| `browser_launch` + `--start-minimized` | **unchanged** (still the DSH TUI) | yes (`-1770,996`, peek 36, `IsIconic = false`) |

So the theft happens at **window creation**, not from any `bringToFront`/`SetForegroundWindow` in our code
(a background process cannot legally take the foreground — Chromium's creation path does). The working
recipe, both halves measured:

1. **Create the window minimized** — `--start-minimized` on the Chrome command line (Windows maps it to a
   no-activate show). This alone removes the theft.
2. **Then park it** with `Browser.setWindowBounds` — verified to leave it visible at the peek
   (`visibleStrip = 36`, not minimized) **with the foreground window unchanged**. The manual equivalent
   works too: `ShowWindow(SW_SHOWNOACTIVATE)` + `SetWindowPos(…, SWP_NOACTIVATE | SWP_NOZORDER)` moved a
   window to `(-1650,996)` at peek 36 with the foreground untouched.

**Code change implied:** pass `--start-minimized` at creation for every spawned owner, and **do not skip
the park when the start was minimized** — the current "minimized starts excepted" rule leaves the window
taskbar-only and loses the tab-strip peek. Using `CONSTELLATION_START_MINIMIZED=1` as the global switch is
the blunt version, because it hits exactly that exception; the flag belongs in the launch path with the
park still applied.

### D7 resolution (measured 19:05–19:12) — **no launch flag prevents it; a focus watchdog does**

**Correction first: the `--start-minimized` conclusion above was wrong.** It came from a single
`GetForegroundWindow` snapshot taken *after* the OS had already handed focus back. Continuous polling
(100 ms) across a normal spawn shows the real timeline:

```
 0.02s  fg '? ?? Continue Bugcrowd Run 6 Handoff'   (the human's TUI, pid 1972)
 8.46s  fg 'about:blank - Google Chrome'            <-- STEAL, at window creation
 9.00s  fg '[focus-e] info — no job set - Google Chrome'   (title refresh, same hwnd)
10.55s  fg '? ?? Continue Bugcrowd Run 6 Handoff'   (focus returns on its own ~2.1 s later)
```

So Chrome holds the foreground for about two seconds and then yields it. That is worse than a snapshot
suggests — it steals, it is felt, and it looks fine to any single-point measurement. Methodology lesson:
**a one-shot focus check is invalid; poll through the spawn.**

**The mechanism.** Windows grants the foreground to Chromium's newly shown top-level window; nothing in the
harness calls `bringToFront`, and a background process cannot legally take the foreground itself. Since no
launch flag changes it (minimized start included), the only reliable counter is to take the focus back.

**The fix that works — a focus watchdog.** Record the foreground hwnd immediately before the spawn; poll at
~40 ms for a few seconds; whenever the foreground becomes a window of the Chrome we just launched, restore
the captured hwnd. Plain `SetForegroundWindow` is refused to a background process, so the restore must use
the attach-thread trick:

```csharp
me = GetCurrentThreadId(); fgT = threadOf(foreground); tgT = threadOf(target);
AttachThreadInput(me, fgT, true); AttachThreadInput(me, tgT, true);
SetForegroundWindow(target);
AttachThreadInput(me, fgT, false); AttachThreadInput(me, tgT, false);
```

Measured on the very next spawn (`focus-g`, same build, `--start-minimized`):

```
watchdog: protecting hwnd=526522 '? ?? Continue Bugcrowd Run 6 Handoff'
  5.34s STEAL by hwnd=855254 '[focus-g] [focus-g] - Google Chrome' -> restoring
        after restore: hwnd=526522 '? ?? Continue Bugcrowd Run 6 Handoff'
watchdog end — steals countered: 1
```

The human, watching their own screen, reported it as flawless — the window still appeared parked at the
bottom with the tab strip, and their focus never left the TUI.

**Implementation notes.** Hook the watchdog right after each launch *and* after any later step that can
activate the window (info-tab creation, `setWindowBounds` park, navigation) — each of those re-shows the
window. Confine it to the process/profile just launched so it never fights a window the human opened, keep
it short (3–5 s at 40 ms), and drop out immediately if the human activates the Chrome window themselves.
Residual: on a slow machine the window may still paint for a frame before the restore lands; the only
truly windowless option is `--headless=new`, which conflicts with the tab-strip preference.
