# Tooling gap list after rounds 6–7 (2026-10-29) — with implementation sketches

**Author:** `lead`. **Question asked:** "any more tool you want, for more performance?" then "add idea of
implement them a bit too".
**Evidence base:** ~900 target requests across 8 Bugcrowd engagements + 4 Google lanes, 0 confirmed
findings; the run-7 review (`Bug_Bounty/Progress/bugcrowd/intel/75-consult-deadlock-review.md`) finding
that of ~370 requests only ~1 P1/P2-shaped cell ever executed; ledger #76 listing **43 never-tested
cells, 20 reachable**; the round-6/7 smoke runs in
`Bug_Bounty/Progress/harness-mcp/r6-smoke/RESULTS-r6.md` + `RESULTS-r7.md`.

The fixture / session / diff / inject primitives are in good shape — do not rebuild them. What is missing
is **memory and extraction**: the run was slow because (a) I could not tell which cells had already been
executed, (b) every verdict ended with a body I had to eyeball, and (c) nothing remembered what a
boundary did last time. Each item below therefore names: the friction, the signature, **how it is built
in this codebase**, and an acceptance test.

---

## 1. `cell_*` — a ledger with memory (highest value)

**Friction.** The "untested cell ledger" is hand-curated markdown and the run-7 review found it wrong in
the optimistic direction. A cell is *object graph + principal + expected verdict* — which a fixture
recipe + `diff_pair` already express; they just have no memory and no queue.

```
cell_register {id, engagement, object, principal, expect: deny|allow,
               recipe?, probe?, miss?, own?, notes?}
cell_run      {id}          -> runs the legs/recipe, stores verdict + evidence ref
cell_status   {engagement?} -> NEVER TESTED | INCONCLUSIVE | NEGATIVE | CANDIDATE table
cell_ledger   {engagement}  -> machine ledger replacing intel/76-style markdown
```

**How I'd build it.** New `src/tools/cell.ts`; register in `src/server.ts` with the existing env
(`sessionFor`, `jars`, `scope`, `budget`). Storage `cells.json` under `config.rootDir` — same place as
`fixture-recipes.json` / `budgets.json` / `session-proofs.json`, i.e. persisted, never in-memory (losing
`budgets.json` on a restart was itself a run-7 bug). Append-only `cell-runs.jsonl`; `cell_status` folds
runs over cells. The execution body is small because the primitives already exist:

```ts
const [probe, miss, own] = await Promise.all([
  performLeg(env, cell.probe, principal, 'cell'),
  performLeg(env, cell.miss,  principal, 'cell'),
  cell.own ? performLeg(env, cell.own, principal, 'cell') : undefined,
])
const verdict = verdictOf({ probe, miss, ...(own ? { own } : {}) })  // src/tools/diff.ts
const ok = expectPasses(verdict.verdict, cell.expect)                // src/tools/recipe.ts:73
```

The one rule that matters: **`NOT_FOUND` is `INCONCLUSIVE`, never `NEGATIVE`.** That is exactly the
false-green we kept making by hand, and the tool should encode it rather than trust the operator.

**Effort** ~1.5 days (4 tools + tests + inventory update). **Acceptance:** a cell whose probe ≡ miss
reports `INCONCLUSIVE`; the 43-row ledger becomes generated output.

## 2. `http_extract` — a value out of a capture, not the body

**Friction.** Every interesting verdict needed one field out of a 20 KB body (`id`, `role`, `owner`).
Today: pull the body into context, or drop to a local script.

```
http_extract {capture_id|last, jsonpath?: "data.items[0].id", regex?, all?}
  -> values only (each capped ~500 chars), plus {read_from: preview|body_file}
```

**How I'd build it.** Captures already carry `capture_id` and, past 20 KB, a `body_file` — read from
disk, never re-fetch. Parse only when `content-type` is JSON; support a deliberately small path subset
(`.key`, `[n]`, `[*]`) in ~60 lines instead of adding a dependency — a full JSONPath engine returns
unpredictable sizes and this tool's whole point is bounded output. Regex path used otherwise. Cap each
value and the total payload, and say when truncated. This is what makes `$var:NAME` chaining real:
capture an object id from a create call, feed it into `fixture_recipe_set` / `cell_register`.

**Effort** ~0.5 day. **Acceptance:** POST → extract id → recipe run using `$var:id`, zero bodies in the
transcript.

## 3. Structural body diff — name the deciding field

**Friction.** `diff_pair` reports `deciding: body` and stops; `http_diff` reports the first diverging
*line*, which on minified JSON is the entire document. I hand-diffed those every time.

```
http_diff {a, b, structural: true}
  -> {kind: json|html|text,
      changed: [{path: "role", a: "member", b: "owner"}],
      suppressed: [{path: "csrf", reason: "volatile key"}],
      truncated?}
```

**How I'd build it.** In the diff path: if both bodies parse as JSON, walk recursively into
`path -> (a, b)` pairs (cap 50 changes, 200 chars each). Suppress a field only when it is a known
volatile **key** (`nonce|csrf|token|timestamp|ts|requestId|trace|expires|date|etag|session`) or its value
is an ISO-8601/UUID/hex-over-32 token — and always **list what was suppressed** rather than silently
dropping it. Honest limitation for the code comment: value-shape suppression can hide the deciding field
when the leaked value *is* a UUID, so `probe`-vs-`own` comparisons suppress nothing. HTML falls back to
element-text/id/class sets, then to the existing line diff.

**Effort** ~1 day. **Acceptance:** A/B differing only in `role` reports `json:role` and lists `csrf` as
suppressed.

## 4. `recipe_baseline` / `recipe_drift` — the transition is the finding

**Friction.** A boundary that denied last week and allows today is a candidate, and that transition is
invisible. The revoke stage is precisely the half never re-run.

```
recipe_baseline {recipe}  -> stores (verdict, deciding_field, statuses, shas, at)
recipe_drift   {recipe?}  -> DENY->ALLOW (opening = candidate) | ALLOW->DENY | UNCHANGED | INCONCLUSIVE
```

**How I'd build it.** `recipe-baselines.json` in `rootDir`; write inside the recipe runner right after the
`expect` step resolves (`src/tools/recipe.ts`, the `case 'expect'` arm ~l.315, where `verdict` and
`expectPasses` are already in scope). Drift is a pure function plus a table. Two rules: **never update
the baseline on `NOT_FOUND`** (a broken fixture must not poison it), and `DENY→ALLOW` optionally appends
an evidence entry so the transition is citable.

**Effort** ~0.5 day. **Acceptance:** open the fixture boundary, re-run, drift names `DENY→ALLOW` without
being told the previous verdict.

## 5. `session_keepalive` — extend the ~20-minute window

**Friction.** Measured twice: Google test accounts verify SIGNED IN then are signed out ~20 min later.
`session_watch` observes this; nothing acts on it, so every AI lane plans in ≤15-minute blocks.

```
session_keepalive {owner, site, every_s: 600, mode: "visit"|"noop"}
  -> periodic account-owned navigation; reports measured lifetime; stops on transition
```

**How I'd build it.** Reuse the proof rules already in `session-proofs.json` and the `session_verify`
machinery (`src/tools/session.ts`): each tick opens a throwaway tab at `rule.url`, asserts
`must_contain` / `must_not_contain`, closes it, logs the tick. Constraints: interval floor 300 s (login
protection politeness), skip a tick when the budget is exhausted, take a per-owner guard flag so a tick
never interleaves with a lane's navigation, and stop cleanly when the browser session closes.
**Honesty requirement:** if the sign-out is server-side and no keepalive prevents it, the deliverable is
the measured lifetime + transition alert — it must not be described as keeping sessions alive when it
only watches them better.

**Effort** ~1 day. **Acceptance:** a 40-minute block reports lifetime and fires the transition; closing
the owner stops the timer with no orphan.

## 6. `report_assemble` — mechanical skeleton from verified cells

**Friction.** "AI drafts, human submits" holds, but assembly (statuses, hashes, timestamps, VRT row) is
still manual for every report.

```
report_assemble {engagement, cells: [ids], template?}
  -> markdown skeleton: repro table (cell → request → verdict → evidence hash),
     precondition list, VRT row, TODO markers for human prose
```

**How I'd build it.** Pure function over `cells.json` + `evidence_log` (already a hash chain). **Refuses**
to assemble if any referenced cell is not `CANDIDATE` — no reports built out of `NEGATIVE` cells. Emits
text (bounded) and optionally writes to the owner's artifacts dir; it does not write into `Reports/`
itself, so the human keeps the last step. Prose stays placeholders by design per `Docs/google-vrp/02`
(AI-slop scoring).

**Effort** ~0.5 day. **Acceptance:** two candidate cells produce a cited skeleton; a NEGATIVE cell makes
it refuse with a named reason.

---

## Small change, disproportionate value

**`diff_pair` auto-captures evidence.** Its four fields (probe/miss/own status + body sha) *are* the
report core, yet a lane must re-run `evidence_capture` to cite them. On every non-`NOT_FOUND` verdict,
append a chain entry `{verdict, deciding_field, statuses, shas}` through the evidence module — the chain
already exists (`evidence_capture` / `evidence_log` / `evidence_verify`); this adds only a verdict-shaped
entry type. Then `evidence_verify` covers the verdict itself rather than a screenshot taken minutes
later. **Effort** ~2 h. **Acceptance:** a `diff_pair` verdict is citable by id without a second capture
call.

## Build order and cost

| # | item | new tools | effort |
|---|---|---|---|
| 1 | `cell_*` | 4 | 1.5 d |
| 3 | structural diff | 0 (2 params) | 1 d |
| 4 | `recipe_baseline` / `recipe_drift` | 2 | 0.5 d |
| — | `diff_pair` auto-evidence | 0 | 2 h |
| 2 | `http_extract` | 1 | 0.5 d |
| 5 | `session_keepalive` | 2 | 1 d |
| 6 | `report_assemble` | 1 | 0.5 d |

**1 → 3 → 4 ≈ 3 days** and removes most of the observed waste. Two cross-cutting chores: the MCP smoke
asserts an **exact tool inventory** (80 today), so the list constant moves with every tool; and each tool
needs a unit test beside `tests/unit.spec.ts` (61 today) plus one integration pass.

## What I would NOT build

- **A captcha/Turnstile solver.** Never — that is the line between testing and evasion (AGENTS.md §8.2).
- **An auto-submitter.** Violates "AI drafts, human submits"; the human is the last gate by design.
- **A high-volume scanner.** Traffic discipline is a hard rule and the VRT rarely rewards it.
- **A second `dupe_check`.** NVD + known-issues is adequate; our misses were auth and business logic,
  which is not a CVE-shaped problem.

## The failure mode to avoid while building item 1

A ledger that records "tested" without recording **what was asserted** is precisely how this run produced
a green pipeline with zero findings. `cell_status` must store the verdict tuple (probe/miss/own status,
body shas, deciding field) — not a checkbox — and must treat `NOT_FOUND` as `INCONCLUSIVE`. If those two
properties are not enforced in code, the ledger becomes another hand-curated markdown file with better
formatting.
