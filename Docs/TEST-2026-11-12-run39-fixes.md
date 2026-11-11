# Test plan — 2026-11-12 round: run-39 defect fixes (Constellation cadac40)

Everything the run-39 Lead's advice file measured as broken, fixed in one
round. No TUI changes this time — restart only Constellation by launching a
fresh `dstc` (build = deploy; `lib/` is already rebuilt).

Round commit: Constellation `cadac40` (plus `3e7784e8ba`/`995cec5e1f` docs).

---

## F1 — `browser_launch_plain` WORKS now (was 100% broken)

The spawn helper's C# was invalid (a quote-escaping bug in our code generator)
— every lane hit it last run. Now verified live end-to-end
(`npm run plain-selftest` in `C:\Code\Constellation-MCP`: 9/9 PASS).

- [ ] `browser_launch_plain {owner:"f1-lane", purpose:"fix test"}` → EXPECT a
      normal launch: `cdp http://127.0.0.1:<port>, pid <n>`, window parked,
      focus NOT stolen, NO Add-Type error.
- [ ] In it: `browser_evaluate {expression:"navigator.webdriver"}` → `false`.

## F2 — `browser_launch` no longer lies about webdriver

Measured: the old "normal-looking" launch reported `navigator.webdriver=true`
(the flag comes from Chrome's AutomationControlled feature, not the
enable-automation switch). Now suppressed for real + verified in the output.

- [ ] `browser_launch {owner:"f2-lane", user_data_dir:"C:\\…\\f2"}` → EXPECT
      the result line to say `navigator.webdriver = false (measured, not
      assumed)`.
- [ ] Re-check in the page: `browser_evaluate` → `false`.

## F3 — `browser_attach` cross-owner guard (the T9 failure)

Attach now (a) records who owns the port, (b) resolves the browser's profile
dir from its process BEFORE adopting, (c) refuses a live foreign owner.

- [ ] A: `browser_launch_plain {owner:"f3-a"}` (note port P).
- [ ] B: `browser_attach {owner:"f3-b", cdp_url:"http://127.0.0.1:P"}` →
      EXPECT a REFUSAL naming A. (Last run: silently adopted.)
- [ ] Kill A's chrome, then B attaches to the SAME port → EXPECT either a
      clean refusal on the dead profile or a clean adopt — never A's window.
- [ ] Attach output now prints `adopted profile <dir> (pid <n>)`.

## F4 — `browser_cookies_import {profile_dir}` no longer overflows

Chrome's microsecond expiry values overflowed the SQLite reader and killed
every import. Divided to seconds inside SQLite now.

- [ ] Import from any real Chrome profile dir → EXPECT cookie counts, not
      "Value is too large".

## F5 — Scope violations: page plumbing ≠ violations

- [ ] Open a login page with recaptcha/fonts in a lane →
      `browser_scope_violations {owner:...}` → EXPECT "N page-plumbing
      request(s) … do NOT stop the lane" and NO STOP banner for assets.
- [ ] `summary:true` → counts by host.
- [ ] `browser_map` warning lines count only actionable ones.

## F6 — `browser_map` compact + RAM

- [ ] `browser_map {}` → EXPECT one line per owner:
      `name · live/plain/attached · #badge · N tabs · host · XXXmb`.
- [ ] `browser_map {detail:true}` → old full view + RAM per owner.
- [ ] `browser_map {history:true}` → retained profiles list.
- [ ] RAM numbers roughly match Task Manager per Chrome.

## F7 — `browser_kill` reaps the whole tree

- [ ] Kill a lane that had several tabs → EXPECT the result to mention
      "exact-match sweep reaped N stray chrome.exe process(es)" (or nothing
      when graceful close got them all) and ZERO leftover chrome.exe with
      that profile in Task Manager.

## F8 — `http_request` signed-out detection

- [ ] Request a JSON endpoint while signed out → EXPECT a
      `⚠ SESSION LOOKS SIGNED OUT` line above the body.

## F9 — RAM guard (default ON at 2500 MB, warn-only)

- [ ] When any lane Chrome passes ~2.5 GB, its `browser_map` line shows
      `⚠RAM` and detail shows `chrome RAM … MB (RAM guard …)`.
- [ ] Optional: set `CONSTELLATION_RAM_AUTOPARK: "1"` in the profile env to
      make the guard CLOSE over-threshold browsers instead of warning.

## F10 — `browser_profiles_reap` (the ~35 GB of old profiles)

- [ ] `browser_profiles_reap {}` → DRY RUN list of dirs older than 14 days.
- [ ] `browser_profiles_reap {older_than_days:7, dry_run:false}` deletes
      them (live/running profiles are never touched).
- [ ] `{include_cdp_dirs:true}` also covers the `%LOCALAPPDATA%\Constellation\cdp-*` lane dirs.

## F11 — zai listing + spawn substitution (ROOT-CAUSED + realigned 2026-11-12, verify on this launch)

The Lead measured the listing still refusing AND spawn_teammate silently
substituting the session model. Root cause (one cause, both symptoms): the
profile's engine peer set was stale 0.1.0-rc.6 — those drivers predate
`agentOptions` support (routes dropped → children run the parent model) and
the package has no `model-selection-settings` export (the policy row could
never load). Both profiles now carry the 0.2.2-rc.1 engine set (dump-config
clean). Verify on a FRESH dstc:

- [ ] `list_subagent_models {provider:"zai"}` → EXPECT glm-5.3 +
      glm-5.3-flash listed, no "not allowed for this Session".
- [ ] `list_subagent_models {provider:"opencode-go"}` → EXPECT deepseek +
      longcat both listed.
- [ ] `spawn_teammate {provider:"opencode-go", model:"longcat-2.5-free", …}` →
      then `list_agents` → EXPECT the member's model to STAY longcat (was:
      silently deepseek). 3-call smoke: spawn → one file write → one message.
- [ ] `spawn_teammate {provider:"zai", model:"glm-5.3"}` consultant → EXPECT
      it actually runs glm-5.3; if provisioning fails, diagnostics should now
      carry the child error (not empty).

## V-round additions from the Lead's live verification (Constellation 67b53bc)

- [ ] V1: a LAUNCHED or PLAIN lane whose page JS fetches an out-of-scope URL
      now shows the violation in `browser_scope_violations` and the map ⚠ line
      (was: silently clean — the observer only wired on attach).
- [ ] V5: `browser_kill` / `browser_reset` on an owner clears that owner's
      stale per-owner scope rule (the 345-rule accumulation is capped now).

## P2 follow-up round (Constellation `4b1b650`, same day)

## F12 — `dns_takeover_check {fetch:true}` honest errors

- [ ] On hosts where the fetch leg cannot connect, the line now says
      `HTTP leg: ERROR (https: …; http: …)` and the verdict is
      **UNKNOWN — transport failed, which is NOT evidence** (was: a false
      "no HTTP listener" folded into the verdict). If it still misreports
      against a host where http_request works, the error TEXT is now in the
      output — send me that line.

## F13 — `http_request` honors a caller `Host` header

- [ ] `http_request {url:"https://target/…", headers:{Host:"other.example"}}`
      → the override now REACHES the wire (hop 0 rides node:http; verified by
      unit test against a live local server). Redirect hops never inherit it.

## F14 — `browser_headers_set / list / clear` (new tools)

- [ ] Set `{"X-Forwarded-Host":"x"}` via browser_headers_set → list shows it →
      clear empties it → browser_reset also clears. Map line shows `+1 hdr`
      while set. Lanes should use THESE instead of raw CDP so headers can't
      silently ride later control legs.

## F15 — request counter on the map

- [ ] `browser_map {}` compact line now includes `reqs N` per owner — the
      per-lane budget signal (read it before each card instead of nothing
      counting for you).

## F16 — secrets reveals are audited

- [ ] `secrets_get {name:…, reveal:true, owner:"<lane>"}` → the reveal lands
      in scope-audit.jsonl with your owner name. (Per-lane read BLOCKING is
      not enforceable — one shared server, self-declared owners — the audit
      trail is the detective control.)

## Still parked (need YOUR decision — dsh engine, off-limits to me)

- Teammate `diagnostics` population (silent "Background subagent failed") and
  longcat route validation — both live in the dsh engine.
- Captcha wall wording: human_task_* are native engine tools too. Until then,
  the Lead's spawn prompts should carry the §11.3 rules verbatim: when the
  AGENT submits — "tick the box ONLY; do NOT press Create/Enter; do not mark
  complete until the dashboards exist" + `park:false`; when the human submits —
  say so explicitly + reload the tab after any failed submit (widget can be
  dead) + a reCAPTCHA v2 token dies in ~120 s (submit immediately or re-tick).
- Fixture registry: keep ONE versioned `Fixtures/REGISTRY.md` in Bug_Bounty
  and have every spawn prompt reference it (fixture facts from memory cost 6
  lane-steers last run) — convention, not a tool.

## Lead verification round 2 (2026-11-12) — results + fixes

The Lead's live verification confirmed V1/V3/V4/V5 and the routing core (no
substitution — child stores show zai/glm-5.3 and longcat-2.5-free actually
running). Round-2 defects and their disposition:

- **R1 (P2, documented, workaround exists)** — the model-selection policy is
  only recorded at agent/created with `firstLiveSeq === 0`, so a `--resume`
  session never gets it and listing still refuses there. Workaround: run the
  listing check in a brand-new conversation (fresh sessions pass — verified).
  The real fix is a fork-patch of the settings plugin (backfill on resume) —
  **needs the human's decision** (it means forking one more engine package).
- **R2 (P2, FIXED — Comet `d180cbbf49`)** — `list_agents` now reports the
  REQUESTED child route per member: `agentProvider` / `agentModel` /
  `agentReasoningEffort` are recorded durably at spawn and returned by
  list_agents, team_snapshot, and the spawn result. (The live Agent options
  don't carry the route, which is why the old fallback read as substitution.)
- **R3 (P2, half-fixed)** — silent death: the roster now observes the child's
  terminal result; a non-completed stopReason or a rejected run journals the
  provider `diagnostic` (or the stopReason) into the member's durable error —
  `list_agents`/`team_snapshot` diagnostics show the CAUSE (e.g. the 429
  loop) instead of `[]`. Operational note stands: **longcat-2.5-free is
  rate-limited right now — don't size a run on it until the 429s clear.**
- **R4 (P3, FIXED)** — the shadow layer's hole is closed: the llm family
  (`dsh-llm`, `dsh-llm-retry`, `dsh-llm-deepseek`, `dsh-llm-pi-ai`) is now
  junctioned to the global runtime's copies in BOTH profiles (12 junctions
  total per profile). Profile-local `@deepseek-ai` = 3 fork tarball builds +
  client-ui + 12 junctions, nothing duplicated.
- **R5 (P3, documented, no fix)** — resumed sessions keep the MCP tool
  catalogue (descriptions) from before the restart; behavior and messages are
  current, the description text is stale. Cosmetic; a fresh session shows the
  new texts.

### Round-2 checks (fresh dstc)

- [ ] `spawn_teammate {provider:"opencode-go", model:"longcat-2.5-free", …}` →
      `list_agents` → the member shows `agentProvider: opencode-go,
      agentModel: longcat-2.5-free` (the money check, now visible).
- [ ] A member whose child dies (e.g. longcat 429) → `list_agents` → its
      diagnostics name the cause (rate_limit / stopReason), not `[]`.
- [ ] Fresh conversation: `list_subagent_models {provider:"zai"}` → glm-5.3 +
      glm-5.3-flash (R1: resumed sessions keep refusing until the backfill
      fix is decided).

## Not in this round (parked from the advice file)

- P2s: `dns_takeover_check` HTTP leg, `secrets_get` per-lane scoping,
  fixture registry resource, human-wall captcha template, budget
  default-on, `http_request` Host-header honoring, CDP extra-headers
  listing, teammate `diagnostics` population (dsh-engine side), longcat
  route validation (dsh-engine side).
- Nothing here touches the dsh engine or the TUI — vendor untouched.
