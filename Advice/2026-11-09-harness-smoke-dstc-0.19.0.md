# Harness smoke after TUI 0.19.0 + dsh 0.2.2-rc.1 (2026-11-09)

> **Status: ADDRESSED (2026-11-09, both defects).** D1 + D2 fixed in
> Constellation `980a028` — `verdictOf` now checks `sameBytes` BEFORE the
> SOFT_ALLOW fall-through (status-divergent + identical bytes →
> AUTHORIZATION_DENIAL, deciding_field `status`, note says
> "IDENTICAL bytes"; SOFT_ALLOW reserved for genuinely different bytes),
> and `cell_register {id, remove:true}` accepts the id-only delete (the
> four create fields moved from zod-required to runtime-enforced on the
> create path, refusal names every missing field). 105/105 tests + smoke
> 97. A fresh `dstc` is required before a running session sees the fixes.

**Author:** `lead` (harness smoke; no program traffic). **Status:** 2 real defects found (D1 verdict, D2 registry API), everything else green.

**Environment measured (not assumed):**
- global `@deepseek-ai/dsh` = **0.2.2-rc.1**; TUI resolved in **both** `%USERPROFILE%\.dsh\profiles\dsh-tui\node_modules` and the global npm root = `@deepseek-harness-tui/dsh-tui` **0.19.0**.
- Comet fork engine packages actually installed in the profile: `dsh-experimental-agent-team`, `dsh-experimental-tool-agent-team`, `dsh-experimental-agent-team-profile` all **0.2.2-rc.1-comet.1** (the `-comet.1` forks, not the upstream 0.2.2 ones).
- `dist/dst-comet.tgz` built 2026-11-09 05:37 +07, migration commit `60ce3a99a1` 05:47 +07; session started 10:42 +07 on that build.

**Scope of the smoke:** one fresh lane (`smoke-01`) doing a bounded Constellation round-trip on `example.com` only, plus Lead-side checks (team board, freeze/resume, release, evidence chain, HTTP capture/replay, fixtures/OOB, MCP-surface tools against the repo's own local stub at `127.0.0.1:18777`). 8 target requests total, all `example.com`. No Bugcrowd or program host was touched.

---

## D1 — `cell_run`/`verdictOf`: status-divergent pair with IDENTICAL bytes is labelled `SOFT_ALLOW` (+ a note that claims "different bytes")

**Repro (recorded):** cell `smoke-harness-diff` (now deleted), probe `https://example.com/` → **200**, miss `https://example.com/smoke-miss-404` → **404**, body sha256 **identical** for both (`25ddf2c883e0…`).
- `cell_run` at 2026-11-09T03:46:00.480Z returned: `SOFT_ALLOW (deciding: body)` — *"another identity got HTTP 200 with different bytes than the MISS CONTROL … a soft allow"*; the same response prints `probe 200 sha=25ddf2c883e0… · miss 404 sha=25ddf2c883e0…` **plus** `cell-runs.jsonl` records `statuses:{probe:200,miss:404}`, `shas:{probe===miss}`, `verdict:"SOFT_ALLOW", deciding_field:"body"`. Evidence chain entry **#309**.
- The same pair through `http_diff` (03:46:11Z) prints: **`STATUS DIVERGES: A=200 B=404`** with the identical sha — so the Agent reading the two tools gets two contradictory descriptions of one pair.

**Where the logic breaks** (`C:\Code\Constellation-MCP\src\tools\diff.ts`):
- `NOT_FOUND` requires **same status AND same body** (lines 36–38), so identical-bytes/different-status falls through.
- `statusDiffers` is computed (line 39) but is **not used** in the 2xx branch (lines 41–60): any 2xx probe that is not a `DATA_LEAK` goes to `SOFT_ALLOW` with `deciding_field: 'body'` and the note *"different bytes than the MISS CONTROL"* (line 58) — asserted even when the shas are equal.
- The file's own header (lines 5–8) and the deny branch (line 71) both say a **status difference means a real decision**; `SOFT_ALLOW` is defined in the tool schema as "2xx but **different bytes**" (diff.ts:118). Both statements are violated by this tuple.
- The unit suite pins only the *different-bytes* case (`tests/unit.spec.ts:672-673`: probe 200 `'dd'` vs miss 404 `'bb'` → `SOFT_ALLOW`), so the identical-bytes variant is untested.

**Impact on our flow:** a cell whose probe is a real object returning the same shell/empty body as the miss control (common with SPA shells, 404-with-the-same-page, JSON `{}` envelopes) becomes **CANDIDATE** on an `expect: deny` cell (`foldCellStatus` maps `SOFT_ALLOW` → CANDIDATE, unit.spec.ts:1050) and the Lead is told the bytes differ when they do not — exactly the kind of false signal the cell ledger exists to remove. It also burns the token budget of the "authorization decision" vocabulary: a status-only existence oracle is not a soft data allow.

**Suggested fix (small):**
```ts
const sameBytes = probe.body_sha256 === miss.body_sha256
if (probe.status >= 200 && probe.status < 300) {
  if (own leg is 2xx && probe.sha === own.sha) return DATA_LEAK
  if (sameBytes) {
    return statusDiffers
      ? { verdict: 'AUTHORIZATION_DENIAL', deciding_field: 'status',
          note: `probe HTTP ${probe.status} vs miss HTTP ${miss.status} with IDENTICAL bytes — the server distinguishes the real object from a random id, but no data differs from the miss control: a status/existence oracle, not a data disclosure` }
      : { verdict: 'NOT_FOUND', deciding_field: 'none', note: '…byte-identical at the same status (handled above)…' }
  }
  return SOFT_ALLOW /* now genuinely "2xx with bytes that differ from the miss control" */
}
```
Add two unit tests: `probe 200/aa vs miss 404/aa` → `AUTHORIZATION_DENIAL`/`status`, and a note-text assertion so "different bytes" can never be printed when the shas are equal.

---

## D2 — `cell_register {remove:true}` refuses an id-only delete

**Repro:** `cell_register {id:"smoke-harness-diff", remove:true}` →
`MCP error -32602: Input validation error: Invalid arguments for tool cell_register: Required at engagement / Required at object / Required at principal / Required at expect`.
The tool description says "`remove: true` deletes", but zod validation runs **before** the remove short-circuit, so a caller following the docs cannot delete without re-supplying the whole cell tuple. Workaround (what I did): send all five fields with `remove:true` → `Cell "smoke-harness-diff" removed.`

**Suggested fix:** validate `remove` first (e.g. `if (args.remove) return removeCell(...)` with only `id` required), or make the four fields optional and reject at runtime only on the create path. Low severity, but it is an API that advertises idempotent delete.

---

## Cosmetic (not filed)

- `cell_run`'s SOFT_ALLOW note says *"another identity got …"* even when both legs are unauthenticated jars — wording only.
- `fixture_hits`: a plain `GET` of the fixture URL records a hit with `canary_seen: 0`; only a request carrying `?c=<canary>` proves exfiltration. That is correct by design (canary is a request-side proof) — the smoke lane initially read it as a defect, so the tool text is fine but the distinction is worth remembering when reading results.

## Verified green (measured, not inferred)

| Surface | Result |
|---|---|
| `spawn_teammate` (fresh) / `send_message` / `wait_agent` / `lane_freeze` / `lane_resume` / `release_teammate` | PASS — freeze visible as `frozenLanes:1`, resume woke the lane, release stopped it |
| Shared task board `team_task_create` → `team_task_get` → claim → complete | PASS (task-13, owner `smoke-01`, revision 3) |
| `browser_launch` park spec | PASS exactly: `screenX -1553 = -1920+367`, `screenY 996 = 0+1032-36`, `945×1012`, owner label window + info tab |
| `browser_owner_info` / `tab_open` (lease) / `browser_snapshot` / `browser_take_screenshot` / `browser_tabs` | PASS; leased tab visible in `browser_map` |
| `browser_network_requests` / `browser_network_bodies` | PASS — 2 bodies written to disk with sha256 |
| `browser_close` / `browser_reset` | PASS — session closed, reset reports nothing to sweep; zero Chrome processes with the lane profile left (only the human's own single browser process remained) |
| `scope_set` / `scope_audit` / `scope_clear` | PASS — every lane request audited ALLOW; per-owner scope did not leak to the Lead; clear removed the rule |
| `http_request` (+`save_body`, jar) / `http_extract` / `http_replay` (url override) / `http_download` | PASS — capture `hr-4`, regex title, replay changed only the URL, download sha matched |
| `evidence_capture` / `evidence_file` / `evidence_scan` / `evidence_log` / `evidence_verify` | PASS — chain grew 308 → **312 entries**, every hash+link intact; scan 0 secrets |
| `fixture_publish` → self-fetch → `fixture_hits` → `oob_close {"__fixtures__"}` → `fixture_list` | PASS — public URL served, canary hit proven, tunnel killed, hits retained (2), no `cloudflared` process left |
| `dns_takeover_check` (example.com) | PASS — claimable FALSE |
| `mcp_tools` / `mcp_diff` / `mcp_auth_gate` (local stub, `MCP_STUB_MODE=normal|auth`) | PASS — snapshot 2 tools, second diff UNCHANGED; gate `OPEN-LIST` → deep `AUTH-BYPASS` (stub open), `TESTED-PROTECTED` in auth mode |
| `mail_status` / `mail_search` (empty alias) | PASS — IMAP auth ok, localized All-Mail folder resolved, empty result explained incl. Spam/Trash fallback |
| `repo_status` | PASS (used by `repo_commit` test in the hunt repo) |
| `budget_set` | PASS — cap 30, lane used 8 |

**Not exercised (deliberately):** `browser_attach` CDP (needs a human-visible Chrome with `--remote-debugging-port`; would steal focus), `human_task_create/resolve` (would flash a wall on the human panel for a fake blocker), `session_proof_set/verify/watch/keepalive` (need a real signed-in surface), `inject_*` (needs a real AI target), `browser_run_code_unsafe` (escape hatch; no need), `recipe_*` run (would need a live fixture), `report_assemble` (needs CANDIDATE cells), `session_compact` (nothing to compact).

## Environment notes (not defects)

- `secrets_list` = **empty** in this session: no `CONSTELLATION_SECRET_*` / `DSH_SECRET_*` env vars are set (no `.dsh-secrets` dir either). Any flow that expects `$secret:<name>` interpolation will fail until one is exported; the current hunt flows use the human's browser session instead, so nothing broke.
- `C:\Code\Dsh_Tui_Comet` working tree is **not clean**: 4 modified files (3 old Advice files + `Advice/2026-11-05-…`, and `assets/dst-comet.ico` 13,846 → 61,837 B) and 13 untracked Advice files from 2026-10-26..30. None of it was touched by this smoke; the icon change is not mine to commit.
