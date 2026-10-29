# Tooling gap list after rounds 6–7 (2026-10-29)

**Author:** `lead`. **Question asked:** "any more tool you want, for more performance?"
**Evidence base:** ~900 target requests across 8 Bugcrowd engagements + 4 Google lanes, 0 confirmed
findings; the run-7 review (`Bug_Bounty/Progress/bugcrowd/intel/75-consult-deadlock-review.md`) finding
that of ~370 requests only ~1 P1/P2-shaped cell ever executed; ledger #76 listing **43 never-tested
cells, 20 reachable**; the round-6/7 smoke runs in
`Bug_Bounty/Progress/harness-mcp/r6-smoke/RESULTS-r6.md` + `RESULTS-r7.md`.

The fixture / session / diff / inject primitives are in good shape — I would not rebuild them. What is
missing is **memory and extraction**: the run was slow because (a) I could not tell which cells had
already been executed, (b) every verdict ended with a body I had to eyeball, and (c) nothing remembered
what a boundary did last time. All six items below attack one of those three.

---

## 1. `cell_*` — a ledger with memory (highest value)

Today the "untested cell ledger" is a markdown file I update by hand, and the round-7 review found it was
wrong in the optimistic direction. A cell is: *object graph + principal + expected verdict*. That is
exactly what a fixture recipe + `diff_pair` already express — they just have no memory and no queue.

```
cell_register {id, engagement, object, principal, expect: deny|allow, recipe?, notes?}
cell_run      {id}                    -> runs the recipe/legs, stores verdict + evidence refs
cell_status   {engagement?}           -> NEVER TESTED | INCONCLUSIVE | NEGATIVE | CANDIDATE table
cell_ledger   {engagement}            -> machine ledger replacing intel/76-style markdown
```

- **Removes:** the "did we already test this?" tax, and cells silently dying as DEAD because nobody
  re-derived them. The 43-cell ledger becomes generated, not curated.
- **Acceptance:** after a run, `cell_status` answers — for every registered cell — tested/not, verdict,
  and the evidence hash, without reading a markdown file.

## 2. `http_extract` — read a value out of a capture without the body in context

Every interesting verdict needed one field out of a 20 KB body (`id`, `role`, `owner`, `shareUrl`).
Today I either pull the whole body into context or hand-write a script.

```
http_extract {capture_id|last, jsonpath?: "data.items[0].id", regex?: "...", all?}
  -> values only, never the body
```

- **Removes:** context burn and the round-trip to a local script; makes `$var:NAME` chaining into
  fixtures genuinely useful (capture an object id from a create-call, feed it to `diff_pair`).
- **Acceptance:** `http_request` POST → `http_extract` jsonpath → `fixture_recipe_run` with `$var:id`
  produces a verdict with zero bodies in the transcript.

## 3. Structural body diff — name the deciding field

`diff_pair` currently reports `deciding: body` and stops; `http_diff` reports the first diverging *line*.
On minified JSON/HTML the first line is the whole document.

```
http_diff {a, b, structural: true}
  -> {json_paths_changed: [...], volatile_suppressed: [nonce, ts, csrf], html_fragments: [...]}
```

- **Removes:** the manual eyeball step between "verdict" and "impact". This is the difference between
  "bytes differ" and "*the `role` field went from `member` to `owner`*" — the sentence a report needs.
- **Acceptance:** an A/B pair that differs only in one field reports that field and ignores nonces.

## 4. `recipe_baseline` — drift detection

A recipe that denied last week and allows today is a **candidate finding**, and that transition is
invisible right now. The revoke stage is precisely the half we never re-ran.

```
recipe_baseline {recipe}   -> stores the verdict tuple (verdict, deciding_field, statuses)
recipe_drift   {recipe?}   -> DENY->ALLOW | ALLOW->DENY | unchanged, since when
```

- **Removes:** reliance on me remembering a prior run; turns the recipe registry into a regression suite
  over authorization boundaries.
- **Acceptance:** change the fixture so a boundary opens, re-run, and `recipe_drift` names the transition
  without being told the previous verdict.

## 5. `session_keepalive` — extend the ~20-minute window

Measured twice: Google test accounts verify SIGNED IN, then are signed out ~20 min later. `session_watch`
*observes* this; nothing *acts* on it, so lanes plan in ≤15-minute blocks and burn the rest re-authing.

```
session_keepalive {owner, site, every_s: 600, mode: "visit"|"noop"}
  -> periodic lightweight account-owned navigation; stops on transition, reports the lifetime
```

- **Removes:** the 15-minute block ceiling on every Google/AI lane.
- **Caveat, must stay honest:** if the session death is server-side and no keepalive can prevent it, the
  tool's *value* is the measured lifetime + a transition alert, not magic. Build it to report, not to
  pretend.

## 6. `report_assemble` — mechanical skeleton from verified cells

"AI drafts, human submits" is the rule; the drafting step is still manual assembly of statuses, hashes
and timestamps.

```
report_assemble {engagement, cells: [ids], template}
  -> markdown skeleton with repro table, evidence hash chain refs, VRT row
```

- **Removes:** the assembly cost between "cell verified" and "draft ready for the human", and makes
  provenance automatic (every claim cites a chain entry).
- **Boundary:** it produces structure and citations only — the prose still gets rewritten by a human,
  per `Docs/google-vrp/02` (AI-slop scoring).

---

## Small change, disproportionate value

**`diff_pair` should auto-capture evidence.** Its four fields (probe/miss/own status + body sha) are
already the report's core; today the lane must re-run `evidence_capture` to cite it. One line in the
handler: on every non-`NOT_FOUND` verdict, append a chain entry with the three shas and the deciding
field. Then `evidence_verify` covers the verdict itself rather than a screenshot taken afterwards.

## What I would NOT build

- **A captcha/Turnstile solver.** Never — it is the line between testing and evasion, and AS-8.2 says so.
- **An auto-submitter.** Violates "AI drafts, human submits"; the human is the last gate by design.
- **A high-volume scanner.** Traffic discipline is a hard rule here and the VRT mostly does not reward it.
- **A second `dupe_check`.** The NVD + known-issues version is adequate; the misses this run were
  auth/business-logic, which is not a CVE-shaped problem.

## Priority if only three get built

**1 → 3 → 4.** The ledger stops the waste, the structural diff turns a verdict into impact, and drift
turns a one-shot test into a monitor. Items 2, 5, 6 are conveniences by comparison.
