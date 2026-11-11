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

## F11 — zai listing (carried from last round — needs this launch)

Profile rows verified by dump (both our insert and the bundle's alias
resolve); the live check needs this fresh dstc:

- [ ] `list_subagent_models {provider:"zai"}` → EXPECT glm-5.3 +
      glm-5.3-flash listed, no "not allowed for this Session".
- [ ] `list_subagent_models {provider:"opencode-go"}` → EXPECT deepseek +
      longcat both listed.

## Not in this round (parked from the advice file)

- P2s: `dns_takeover_check` HTTP leg, `secrets_get` per-lane scoping,
  fixture registry resource, human-wall captcha template, budget
  default-on, `http_request` Host-header honoring, CDP extra-headers
  listing, teammate `diagnostics` population (dsh-engine side), longcat
  route validation (dsh-engine side).
- Nothing here touches the dsh engine or the TUI — vendor untouched.
