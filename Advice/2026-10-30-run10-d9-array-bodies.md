# D9 — JSON array bodies are silently corrupted to `[object Object]`

> **Status (2026-10-30 02:20 +07):** OPEN, verified live against build `98c8cc6` (the run-9 fix build).
> Found in the field during run 10: a `cell_run` whose three legs returned **byte-identical HTTP 500s**.
> The lane correctly refused to call that a negative — it is a **client-side body corruption**, not a server verdict.
> Fix is three lines in `src/tools/http.ts` (§3). Raw evidence: run-10 checkpoint
> `Bug_Bounty/Progress/bugcrowd/RUN10-CHECKPOINT-2026-10-30.md` §6.3 (plus the live `/echo` pair quoted in §1 here).

---

## 1. Repro (loopback, 30 seconds)

Oracle route `/echo` returns the exact bytes it received. Two `http_request` calls, same endpoint, same method:

| body sent | bytes the server received | content-type received |
|---|---|---|
| `{"query":"{ viewer { id } }"}` (object) | `{"query":"{ viewer { id } }"}` — 29 B | `application/json` ✅ |
| `[{"query":"{ viewer { id } }"}]` (array) | **`[object Object]` — 15 B** | **`text/plain;charset=UTF-8`** ❌ |

Same result for any JSON array of objects — which is exactly the shape of a **batched GraphQL request**, the form the
Statuspage management API uses (and many GraphQL products use for multi-operation calls). Scalars (numbers, booleans)
have the same failure: `5` is sent as the string `"5"` rather than JSON `5`; `null` is sent as `"null"`… or dropped.

**How it reads from the lane's side:** all three `diff_pair`/`cell_run` legs use the same builder, so they all send the
same garbage and all get the same error. A run that sees *identical* non-2xx on own/probe/miss has to treat it as a
leg-format failure — but with a 500 rather than a 404 it is easy to mis-attribute to the target ("the API is down"),
and the verdict silently degrades to `INCONCLUSIVE` after burning budget. In run 10 it cost three requests and a
confusing detour.

---

## 2. Cause

`src/tools/http.ts`:

```ts
function isJsonObject(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v)   // arrays excluded on purpose
}

const body = bodyInterp === undefined ? undefined
  : (isJsonObject(bodyInterp) ? JSON.stringify(bodyInterp) : String(bodyInterp))   // <-- arrays land here
```

The ternary was written for a two-case world (object / raw string). An array — and every JSON scalar — falls into the
`String()` branch. `String([{...}])` is `"[object Object]"`. The content-type is only auto-set when `isJsonObject()` is
true, so the request also loses `application/json` and arrives as `text/plain`.

The same expression exists in the browser transport (`performBrowserRequest`, ~l.302-307), so `http_request {browser:…}`
corrupts arrays identically. `http_download` has no body. `diff_pair` legs, `cell_run` legs and recipe `expect` legs all
funnel through these two functions, so one fix covers every primitive.

---

## 3. Fix and tests

```ts
// Encode exactly three cases: absent, raw string (caller owns the bytes), everything else as JSON.
const body = bodyInterp === undefined ? undefined
  : typeof bodyInterp === 'string' ? bodyInterp
  : JSON.stringify(bodyInterp)
```

…and set the header whenever the body is not a string:

```ts
if (spec.body !== undefined && headers['content-type'] === undefined && headers['Content-Type'] === undefined
    && typeof spec.body !== 'string')
  headers['content-type'] = 'application/json'
```

Apply in **both** `performRequest` and `performBrowserRequest` (same three lines), and add unit coverage:

1. array body → server sees `JSON.stringify(array)`, `content-type: application/json`;
2. object body → unchanged (existing behaviour must not regress);
3. **string** body → passed through verbatim, **no** content-type invented (callers send form data / raw XML this way);
4. scalar body (`5`, `true`) → JSON-encoded;
5. an array containing a `$secret:NAME` → interpolation still applied (the interpolator already walks arrays).

A regression test should assert on the **bytes the mock client received**, not on the tool's own formatting — a test
that only checks "the call succeeded" cannot see this class of bug.

---

## 4. One-line version for the implementer

`isJsonObject()` is the wrong gate for body encoding — use `typeof !== 'string'`; keep the object path as-is, add an
array case, and pin the received bytes in a test.

---

## 5. Adjacent harness observation (not D9, no fix sketched)

Killing a process that an earlier `pwsh Start-Process` started, via `Stop-Process`, aborts the DSH subprocess runner:

```
subprocess-local: Windows Job runner exited with exit code 4294967295 before proving its managed range empty
```

It happened twice, both times right after `Stop-Process` on a `node` helper started in a previous command; `taskkill
/PID <pid> /F` then worked and left the runner healthy. Nothing was lost, but a lane that starts and stops its own
helper will read this as "the tool crashed". Either document `taskkill` as the way to stop a helper, or make the runner
tolerate a managed process disappearing between polls.
