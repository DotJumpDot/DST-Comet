# Test plan — 2026-11-11 round: lag · torn frames · taskbar badges · anti-bot plain Chrome

Round commits (all pushed): Constellation `a39e3e4` · DST-Comet `e3fedb2d19` · DST-Moon `2f5295f`.
Test doc for the human. Tick the boxes as you go; anything red, tell the agent with a screenshot.

---

## 0. Before you test (required once)

- [ ] Close every running `dstc` / `dstm` window and every leftover lane Chrome
      (old sessions still run the OLD code — nothing below lands until relaunch).
- [ ] Fresh `dstc` in `C:\Code\Bug_Bounty` (this also restarts Constellation from
      the repo's freshly built `lib\`).
- [ ] Optional but recommended for T2: close your own Chrome windows so the
      taskbar only shows lane windows while testing T1.

---

## T1 — Taskbar badge is actually VISIBLE now

What changed: the old overlay call succeeded but this Windows 11 taskbar never
painted it. Now each Constellation Chrome window gets (a) its own taskbar
identity (AUMID) and (b) the window icon REPLACED — the whole taskbar button
becomes a blue square with a white number. Numbers continue from the pool
(last used was 91, so fresh launches start at 92).

- [ ] Launch a lane Chrome the normal way (`browser_launch` or
      `browser_launch_plain {owner:"t1-lane"}`).
- [ ] EXPECT: within ~10 s its taskbar button is a **blue square with a white
      number** — NOT the Chrome logo, NOT a tiny corner badge.
- [ ] Launch a second lane (`t1-lane2`) — EXPECT two separate buttons with two
      different numbers, not grouped with your own Chrome.
- [ ] The tool output says `Taskbar badge: N …` and the info-tab title ends
      `· taskbar N` — numbers should match the pixels.
- [ ] Close one lane (`browser_kill {owner:"t1-lane2"}`) — its number is freed;
      the next launch should reuse the lowest free number.
- Notes: if Chrome ever resets its icon (rare — some Chrome UI events do), the
      number still names the window in tool output + tab title. If you ever see
      NO number at all again, tell the agent — the fallback would be a badge
      reapplied on a timer.

## T2 — Lag under your normal 12–13 concurrent lanes

What changed: every lane event (tool call/result/progress) used to trigger a
full dashboard rebuild + renderer wake **synchronously, one per event**. Now
bursts coalesce into at most one rebuild per frame (~16 ms), and the ~100
dead/settled lane rows from churn history are no longer re-allocated on every
frame.

- [ ] Run a normal hunt at your usual 12–13 lanes.
- [ ] EXPECT: typing in the input while lanes stream feels snappy; the freeze
      bursts (the ones that used to make you wait seconds mid-keystroke) are
      gone or much rarer.
- [ ] Watch Task Manager → the `dstc` node process: average CPU should sit far
      below the old ~80%-of-one-core constant burn (it will still spike during
      real work — that's fine).
- [ ] If it is STILL laggy: do not let the agent guess — say "still laggy" and
      the next step is the profiling relaunch (`--cpu-prof` +
      `analyze-cpuprof.cjs`), which pins the exact function.

## T3 — TUI no longer goes "messy" (torn/interleaved frames)

What changed: streamed tool output kept raw `\r` and escape bytes (by design)
and no renderer ever stripped them — one stray control byte moved the terminal
cursor while the TUI's model stayed put, so later frames painted on top of old
ones (your screenshots: two renders interleaved, ghost stack traces, counters
in wrong rows). All lane/job output lines and result previews are now
sanitized at the source, and Constellation error stacks are trimmed (no more
10-line playwright dumps in the transcript).

- [ ] During the same 12–13-lane run, watch for the old "messy" state —
      duplicated ghost text, rows bleeding into each other, numbers spliced
      into words.
- [ ] EXPECT: you should never need to drag-select or resize the window to fix
      the display again. If it still corrupts, screenshot it and note WHICH
      tool's output was on screen (that identifies the unsanitized path).

## T4 — `browser_launch_plain`: the anti-bot lane browser (NEW TOOL)

Replaces the 12-line `Start-Process chrome … --remote-debugging-port … +
browser_attach` recipe. Real chrome.exe, zero automation flags, free port,
warm profile reused across runs, popup suppression, no focus steal.

Call: `browser_launch_plain {owner:"t4-lane", purpose:"plain-launch test"}`

- [ ] **Focus:** click into another window first, then launch. EXPECT: your
      focus/caret stays where it is — the Chrome window appears parked at the
      bottom edge without stealing the cursor. (The old launches always yanked
      focus once.)
- [ ] Output reports: `cdp http://127.0.0.1:<port>, pid <n>, profile
      …\profiles\plain-t4-lane (warm — reused across runs)`, plus the badge
      note. Port is allocated for you — no more lane port collisions.
- [ ] **No webdriver:** in that browser run (as the lane)
      `browser_evaluate {expression:"navigator.webdriver"}` → EXPECT `false`.
- [ ] **Warm:** close it (`browser_kill`), launch the same owner again →
      EXPECT same profile dir (cookies, incl. any solved Cloudflare
      clearance, persist), and the second launch is FASTER (warm profile).
- [ ] **Idempotent:** calling it twice on a live session returns the SAME
      browser (no second window).
- [ ] Park position respected (tab strip peeking at the bottom of screen 2,
      the usual spec).

## T5 — `browser_kill`: safe, graceful close (NEW TOOL)

- [ ] `browser_kill {owner:"t4-lane"}` → window closes; message says graceful.
- [ ] Relaunch that owner → EXPECT **no "Restore pages? Chrome didn't shut
      down correctly" bubble, ever** (the profile records a clean exit).
- [ ] Safety: with two lanes `t5-a` and `t5-ab` running, kill `t5-a` →
      EXPECT `t5-ab`'s window UNTOUCHED (the old substring-taskkill mistake
      that once killed 61 processes can't happen — matching is exact-path).
- [ ] Orphan mode: close the dstc session while a plain Chrome lives, start a
      fresh dstc, then `browser_kill {owner:"t4-lane"}` → EXPECT it kills the
      orphaned Chrome by exact profile match.

## T6 — Popup suppression (the bubbles from your screenshot)

What changed: every Constellation launch path now seeds the profile with
password-manager OFF + clean-exit prefs, plus the hide-crash-restore flag;
plain launches also close gracefully. (The bubbles you photographed came from
lanes hand-rolling `Start-Process` on bare temp profiles — that path is now
obsolete; if a lane still hand-rolls, IT owns its popups.)

- [ ] Have a lane sign up somewhere with a password via a Constellation
      browser → EXPECT **no "Save password?" bubble**.
- [ ] Kill a lane Chrome (or crash it), relaunch the owner → EXPECT **no
      "Restore pages?" bubble**.
- [ ] The extension-removal dialog you saw: that comes from profiles that
      CARRY an extension (copied base profiles). Plain/Constellation-fresh
      profiles never load extensions, so with `browser_launch_plain` it
      should not appear. If you see it on a specific reused profile, tell the
      agent WHICH profile dir.

## T7 — Cloudflare / challenge detection on navigate

What changed: `browser_navigate` now classifies challenge pages (Cloudflare
managed / interactive Turnstile, reCAPTCHA, hCaptcha) instead of returning a
confusing empty snapshot, and gives managed challenges ~6 s to self-clear.

- [ ] Navigate a lane to a Cloudflare-fronted site that challenges you.
- [ ] Managed case → EXPECT either it self-clears and you get the real page,
      or the output starts with `⚠ CHALLENGE (cloudflare-managed)` + advice
      to wait and re-read.
- [ ] Interactive Turnstile → EXPECT `⚠ CHALLENGE (cloudflare-interactive)`
      telling the lane to raise a human task (name the taskbar number) —
      one human click, then the lane re-reads.
- [ ] Combined with T4 warm profiles: the MORE you reuse a lane's plain
      profile through challenges, the FEWER challenges it should see
      (clearance cookie persists per machine+Chrome+IP).

## T8 — Token/output trims

- [ ] `scope_get {}` with many owners armed → EXPECT the per-owner list shows
      the first 8 names + `… +N more` (was: hundreds of names, ~3 KB per
      call).
- [ ] `browser_map {}` same trim on the scope line; owner rows still show
      cdp port + pid for plain sessions (state is now explicit).
- [ ] A lane runs `browser_run_code_unsafe` code that throws (e.g.
      `decodeURIComponent('%')`) → EXPECT a short 3-line error + "(N stack
      lines trimmed…)", not a 10-line playwright stack.

## T9 — Cross-owner protection (D2)

- [ ] Owner A: `browser_launch_plain {owner:"t9-a"}` (note the port).
- [ ] Owner B tries `browser_attach {owner:"t9-b", cdp_url:"http://127.0.0.1:<same port>"}` →
      EXPECT a REFUSAL naming owner A — two lanes can never adopt the same
      browser again.

## T10 — Moon twin (`dstm`)

- [ ] Fresh `dstm` boots clean; the same coalescing + sanitize code is in
      (no Constellation there — unchanged, Comet-only as always).
- [ ] Quick typing/render sanity in a normal Moon session.

---

## Known NOT-new (do not report as regressions)

- Comet TUI gate failures `verify:contract`, `verify:terminal-images`,
  `verify:scroll-drift` — pre-existing before this round (two older ones now
  pass).
- Constellation is still NOT on Moon/Star — by design.

## Not in this round (parked, from the lead's advice + research)

- D1 attach-after-server-restart still becomes a silent launch (needs a
  persisted binding); D3 redirect-following scope gap; D4 page-beacon census
  mode; D5 mail_wait matcher; D6/D7 model validation + failed-name release;
  D8 goal errors; D10 png-timeout isolation.
- Future anti-bot round (details in Appendix A): humanized trusted Turnstile
  clicks, solver ladder (OCR sidecar → CapSolver), `Runtime.enable`
  side-channel patch.

---

## Appendix A — Anti-bot research findings (2026-11-11)

Everything the round's research surfaced, kept here so the next round (or the
lead) can pick up without re-reading eight repos. Sources: the user's 8
GitHub repos + the user's own passing projects `C:\Code\Maki_Project\Maki_Live`
and `C:\Code\StarCodex` (both already beat TikTok/Akamai and Cloudflare-class
WAFs in production).

### A.1 The two stacks that already pass (the user's own projects)

**Maki_Live (TikTok/Akamai)** — a local "sign server" sidecar:
- Real **headed** Chrome (headless is detected by the Akamai edge) driven by
  puppeteer-extra + stealth plugin, using the user's installed Chrome binary,
  parked off-screen (`--window-position=-32000,-32000`, then SW_HIDE).
- `ignoreDefaultArgs: ["--enable-automation"]` + `--disable-blink-features=
  AutomationControlled` kills the webdriver source.
- **Persisted warm profile** (.chrome-profile, real cookies accumulate) with
  the operator's real session cookies injected.
- All blocked work is done **from inside the page** (same-origin in-page
  fetch, real navigations) — the WAF "cannot distinguish this from the page
  asking for its own data."
- No solver at all: stub detection (<5 KB body = WAF stub, fail never parse),
  interstitial auto-click "Something went wrong → Refresh", and **session
  rotation** — flagged sessions heal by rebuilding the browser session;
  keep-warm rotates every 30 min preemptively.

**StarCodex (Cloudflare ladder, Android)** — three-tier transport
(dio → Cronet → WebView) but the portable lessons are:
- **cf_clearance is bound to the TLS fingerprint + UA + IP that solved it** —
  naive cookie-copying into a different client bounces. Solve once in a real
  engine, keep the traffic inside that same engine (or an identical-
  fingerprint one).
- Challenge-signature detection: 403/429/503 + `server: cloudflare` + body
  markers (`just a moment`, `cf-chl`, `challenge-platform`, `checking your
  browser`) → escalate transport.
- Managed challenges **self-clear in a clean real WebView within seconds** —
  poll `document.title` every ~600 ms with double-confirm instead of
  interacting. Interactive Turnstile → human once, in a VISIBLE view.
- Persistent profile + storage/cache ON (Cloudflare's own mobile docs: 
  challenges fail on restrictive/cleared storage).

→ Shipped in this round from these two: plain-Chrome route (`browser_launch_plain`),
warm profiles, challenge detection + managed-clear polling + advice, no-focus
launch, graceful close.

### A.2 The 8 GitHub repos — status and verdict

| Repo | Status | Portable takeaway |
|---|---|---|
| feder-cr/invisible_playwright | 🔥 very active | The anti-bot manual (A.3) — driver-side detection, click trust, docs alone worth reading |
| jo-inc/camofox-browser | active | Stealth browser MCP (architecture sibling): human-login-once via VNC → export storage state → reuse headlessly; rotate-on-block; per-user persisted profiles |
| VeNoMouS/cloudscraper | alive (2025) | Clearance bound to exact UA+IP; solver-provider abstraction (2captcha/CapSolver/…); rotate strategies with `ban_time` cooldown (default 300 s) |
| Anorov/cloudflare-scrape | dead (2023) | IUAM-era; survives: solve-once-in-real-browser → export (clearance, UA, IP) as a bound bundle for cheaper clients |
| Eltion/Kissanime-Auto-Complete | dead (2018) | Survives: finite captcha pools — sampled-substring hash of the image + precomputed answer table, and **reload-and-retry** when the draw is unknown |
| Kagami/chaptcha | historical | Survives: local OCR **sidecar** (HTTP/ONNX) consumed by the browser layer; pipeline = denoise → Hough line removal → segment → classify |
| GomesAdhikari/OCR-chaptcha-solver | dormant | Concept: small CRNN/CTC model cracks a fixed-template text captcha with ~1k labeled samples |
| shaik1729/jntua_rtoe | dormant | Concept: delegate hard captchas to a paid solver API from inside the automation loop |

### A.3 The diagnosis (why we pass fingerprinting but lose challenges)

From invisible_playwright's docs — matches our measured situation exactly:

1. **CDP side-channels (the big one):** Playwright-over-CDP calls
   `Runtime.enable` to track execution contexts; a page can provoke and time
   the context-creation machinery. The community fix (rebrowser-patches /
   Patchright): don't call `Runtime.enable` automatically — create isolated
   worlds by hand (`Page.createIsolatedWorld`), evaluate via
   `Page.addScriptToEvaluateOnNewDocument` + bindings. Also: never touch
   `Debugger.*` on page realms (attaching disables JIT → timing distribution
   is page-measurable), and `e.stack` leaks `debugger eval code` frames.
2. **Turnstile's interactive tier "stopped checking the browser and started
   checking for a click":** a scripted click is never trusted. It must ride
   the real input pipeline (CDP `Input.dispatchMouseEvent*` → `isTrusted`
   true) with **humanized motion**: Bezier-arc path, variable inter-event
   delay, dwell before press, small overshoot-and-correct. Constellation's
   `browser_force_action` already dispatches trusted CDP input — it just
   moves robotically. **Cheapest high-leverage upgrade in this whole
   appendix.**
3. **Rhythm is a signal:** an agent's think-act loop pauses with LLM-latency
   regularity "no human produces" — randomize inter-action delays globally,
   not just per gesture.
4. **Consistency beats perfection:** "a value being wrong matters less than
   two values disagreeing." Keep one stable persona per profile; locale/
   timezone/geo must match the egress IP; and 40% of one famous site's
   blocks traced to just 5 JA3 TLS fingerprints — real Chrome has a perfect
   JA3, so never put a TLS-terminating proxy in front of it.
5. **Spoofing ladder:** page-level shims (detectable) < driver-level
   (Patchright/rebrowser) < engine-level (Camoufox/invisible). We are at
   "real Chrome + driver" — the remaining gap is exactly items 1-2.

### A.4 Next-round roadmap (ranked)

1. **Humanized trusted clicks** — upgrade `browser_force_action` with
   Bezier-arc mouse paths, jittered delays, dwell + overshoot. Small,
   self-contained, attacks Turnstile directly.
2. **Runtime.enable avoidance** — evaluate rebrowser-patches as a
   playwright-core patch or Patchright as a drop-in for the plain-launch
   path. Bigger project; removes the driver side-channel.
3. **Rotate-on-block** — when a lane hits an uncleaable challenge, auto-
   suggest a FRESH profile (and bench the burned one ~5 min) instead of
   grinding the same identity.
4. **Human-once handoff, formalized** (camofox pattern) — challenge in the
   visible window → human clicks once → warm profile keeps the clearance for
   the rest of the engagement (mostly exists via walls + warm profiles;
   formalize the export/reuse).
5. **Solver ladder for image captchas** — only if we hit them often:
   hash-DB reload-retry → local ONNX OCR sidecar → CapSolver/2captcha API
   (needs the human's API key + budget).

## Rollback (if something is badly wrong)

- Constellation: `git revert a39e3e4` in `C:\Code\Constellation-MCP`, rebuild.
- Comet TUI: `git revert e3fedb2d19` in `C:\Code\Dsh_Tui_Comet`, repack +
  reinstall (or reinstall the previous tarball from dist backups if kept).
- Moon: `git revert 2f5295f` in `C:\Code\DST-Moon`.
