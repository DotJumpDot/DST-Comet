# 2026-11-06 — four harness/MCP asks from the P1/P2 hunting plans

> **Status: IMPLEMENTED (2026-11-07, DST-Comet harness round — all four).**
> #1 `browser_network_bodies` — the browser session now keeps LIVE response
> handles (last 200) and the tool exports method/URL/status + redacted request
> headers + both bodies to the owner's artifacts dir (sha256, byte counts,
> short redacted preview). Honest limit kept: Playwright disposes bodies after
> navigation, so an unavailable body reports the REASON instead of failing
> silently — call it right after the flow, not an hour later. The HAR-export
> variant was not added (the bodies tool covers the replay-card need).
> #2 `dns_takeover_check` — CNAME chain walk, provider guess from fingerprint
> table **v2026-11-07.1** (15 providers, can-i-take-over-xyz derived), verdict
> claimable TRUE/FALSE/UNKNOWN naming its signal; `fetch:true` reads the origin
> page (scope guard first on EVERY host, 1 req/s, stops on 429). NO claiming,
> ever. Conservative by design: a resolving GitHub-Pages/Heroku-style host
> reads UNKNOWN until fetched (their unclaimed state only shows in HTTP);
> trafficmanager/azureedge NXDOMAIN reads claimable:FALSE (protected).
> #3 `evidence_scan` — 13 patterns over an owner's artifacts or an explicit
> root; hits are first4…last4 + sha256 + a masked context line, placeholders
> counted separately, one chain entry per scan. Values never appear — not in
> the output, not even in the chain note (file:line + sha only).
> #4 `repo_commit` — a staged rename whose destination is inside the given
> paths (directory paths count) now pulls its source into the commit
> automatically; no new argument needed. "Pushed." is verified against
> `git status -sb` (one retry, then an honest PUSH UNVERIFIED error).
> Verified: `npm run verify` — 105/105 tests, MCP SMOKE PASS (97 tools, was
> 94). A fresh `dstc` is required before the lanes see the new catalog.

**Origin:** external GLM 5.3 review of the three Orchestra strategies (`Progress/plan/orchestra-review-glm53-2026-11-06.md`
§10) plus what actually happened while executing its first recommendation tonight. These are the gaps that cost real
work, not nice-to-haves. Everything else the plans need (second tenant, `fixture_forge`, public OOB tunnel, `dupe_check`,
`diff_pair`, `evidence_capture`) already exists.

---

## 1. `browser_network_bodies` — the captured-body gap (highest value)

**What happened:** the depth plan's T1 card (lifecycle/webhook forgery) needs the **exact request the app made** — headers,
body, the JWT shape — so it can be replayed with one field changed. `browser_network_requests` returns method/URL/status
only; the body is only visible in devtools by hand, and `browser_run_code_unsafe` can get it only by re-driving the flow
with `page.on('response')` before the action. Tonight's cappsule/ost-consulting work lost ~20 requests re-driving flows to
capture bodies that had already been sent.

**Ask:** `browser_network_bodies {owner, url_contains, method?, limit?, max_bytes?}` → for each matching request already
observed in the session: URL, method, status, request headers (secrets redacted), **request body**, **response body**,
each with sha256 + byte count, bodies written to the owner artifacts dir with a short preview. A HAR export
(`browser_network_har {owner, save:true}`) would cover the same need if bodies are already retained.

**Why it matters:** every "replay this call with one field varied" card (`http_replay`, `diff_pair`, T1/T2/T3) depends on
having the genuine call, and the current path is hand-copying from devtools.

---

## 2. `dns_takeover_check {hosts[]}` — T0 step 1 as one call

**What happened:** the first T0 sweep was hand-rolled `Resolve-DnsName` + an eyeball judgement per host
(`Orchestra/02-depth-p1p2-severity/T0-SWEEP-LOG.md`): 8 hosts, CNAME chains, fingerprinting "is the terminal target a
claimable service". It works but it is error-prone and undocumented, and the provider-fingerprint table (S3 `NoSuchBucket`,
Heroku "no such app", GitHub Pages 404, Azure/Fastly dangling) lives in my head.

**Ask:** `dns_takeover_check {hosts[]}` → per host: CNAME chain, terminal provider guess, a `claimable: true|false|unknown`
verdict with the fingerprint that produced it, and the HTTP status the origin currently returns (optional `fetch:true`,
scope-guarded). **No claiming, ever** — read-only, same rule as `Methods/75` C1. The fingerprint table should live in the
tool, versioned.

**Why it matters:** this is the highest-severity class in the ecosystem and it is currently the least mechanised step.

---

## 3. `evidence_scan {glob|owner, patterns?}` — secret scanning as a chain step

**What happened:** tonight's scan (`Tools/scan-bundle-secrets.ps1`) covered 4,780 files / 114 MB and found 593 pattern hits,
0 real credentials. The value is real but the output is a repo file, not an evidence-chain entry, and the redaction rules
(`first4...last4` + sha256, placeholder filter) are re-implemented in a script rather than enforced by the harness.

**Ask:** `evidence_scan {owner?, root?, patterns?}` → runs the same pattern set (AWS/Google/Stripe/Slack/GitHub/SendGrid/
PEM/JWT/Mongo/SQL/`sharedSecret`) over the owner's artifacts or a path, returns hits with **sha256 + redacted value +
context**, never the value, and appends one chain entry (`evidence_file`-style) so the scan itself is evidence.

**Why it matters:** "we never grepped the bundles" was true for 32 runs. With a harness tool it becomes a one-call step of
every lane, and the redaction discipline stops depending on whoever writes the script.

---

## 4. `repo_commit` and `git mv` renames

**What happened:** staging a folder rename (`Orchestra/STYLE-1-ONE-MODEL.md → 01-daily-p3p4-volume/…`) with
`repo_commit {paths:[new, …]}` is refused — *"the index already holds staged changes outside your paths:
Orchestra/01-daily-p3p4-volume/SPAWN-PROMPTS.md, …"* — because the rename's **old** path is staged too. The workaround was
a manual `git add -A` + `git commit -F`, which bypasses the tool's message formatting and its path validation.

**Ask:** accept a rename whose source path is the git-mv source of one of the given paths, or add
`allow_staged_renames: true` / an explicit `renames: [{from, to}]` argument. A second, smaller nit: `repo_commit` reports
the commit even when a later `git push` needs a retry (GitHub returned `fatal error in commit_refs` twice tonight) — a
`push_and_verify` that reads back `git status -sb` would make the "pushed" claim truthful.

---

## Priority

1. `browser_network_bodies` — blocks every replay-style card in the new depth/sweep plans.
2. `dns_takeover_check` — the P1 class most worth mechanising, currently the most manual.
3. `evidence_scan` — turns a one-off script into lane discipline plus evidence.
4. `repo_commit` rename support — friction, not correctness.

Nothing here changes scope discipline: all four are read-only or strictly local.
