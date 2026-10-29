# Round-9 verification — one defect left (browser-transport credential carry)

> **Status (2026-10-30 01:55 +07):** 10 of 11 run-9 claims verified live against build `98c8cc6` / `07c24d8`.
> **D8 is open:** the browser transport still forwards `Authorization` across a cross-host redirect hop.
> §2 has the repro, the code site, and the exact patch + test. Everything else in the round-9 list holds —
> §5 lists what I verified so it does not get re-litigated.
> Raw evidence: `Bug_Bounty/Progress/harness-mcp/r9-smoke/RESULTS-r9.md`.

---

## 1. The good news, briefly

These were checked by live call, not by reading the commit message: redirect hop gating with the audited
`http_request(redirect hop 1)` DENY line; `browser_navigate` / `tab_open` / `session_verify` failing closed on a
landed out-of-scope URL with the tab cleared to `about:blank`; `http_download {browser}` naming the file from the
**final** URL; binary bodies suppressed on **both** transports; all four DBSC branches naming their signal
(NOTE on no-match, WARNING on match, INCONCLUSIVE on unreadable); `context_status` working on the rc.2 host;
76/76 tests.

And the one that mattered most to the human: the **focus watchdog works**, measured by my own 40 ms poll running
*through* the spawn — our Chrome took the foreground at `01:47:01.611` and it was back on the TUI at
`01:47:01.706`, a ~95 ms steal, with `focus-guard.log` naming only our pids and the window still parked at the
36 px peek. The guard did not touch the human's own Chrome afterwards. That complaint is closed.

---

## 2. D8 — browser transport keeps `Authorization` on a cross-host hop

**Claim under test:** "every HTTP transport now follows redirects one hop at a time and scope-asserts each
`Location` … Cross-host hops also drop the Authorization header and rebuild cookies per-host."

**Repro** (loopback oracle, scope `127.0.0.1:8799` + `127.0.0.2:8799`; `/cross` 302s to the other host):

| leg | request | body received on the other host |
|---|---|---|
| jar | `http_request {url:/cross, auth:bearer sekrit-r9, redirect:follow}` | `{"host":"127.0.0.2:8799","auth_present":false}` ✅ |
| browser | same but `browser:"r9-verify"` | `{"host":"127.0.0.2:8799","auth_present":true,"auth_marker":"sekrit-r9"}` ❌ |
| same-host control | `{url:/same}` both transports | `auth_present:true` (correct — not over-stripped) |

`http_download` in **browser** mode on the same chain drops it correctly, so this is specifically the
`http_request`-family browser transport.

**Code site:** `src/tools/http.ts`, `performBrowserRequest` (~l.325-340):

```ts
let currentUrl = spec.url
let currentMethod = spec.method ?? 'GET'
let currentData = body
let response = await client.fetch(currentUrl, { method: currentMethod, headers, ... })
let hops = 0
while (spec.redirect === 'follow') {
  const hop = redirectHop(response.status(), response.headers().location ?? ..., currentUrl)
  if (hop === undefined || hops >= MAX_REDIRECT_HOPS) break
  scope.assert(hop.url, owner, `${tool}(redirect hop ${hops + 1})`)   // scope: guarded
  hops++
  currentUrl = hop.url
  if (hop.get) { currentMethod = 'GET'; currentData = undefined }
  response = await client.fetch(currentUrl, { method: currentMethod, headers, ... })  // headers: NOT stripped
}
```

The jar loop (~l.218) and the download loop (~l.555) both call `crossHostHopHeaders(headers, toUrl, fromUrl)`;
this loop reassigns only `currentUrl`, so the original header map — bearer token included — rides every hop.
The download loop also shows the safe idiom: capture `fromUrl = currentUrl` **before** reassignment, then strip.

**Patch sketch** (mirrors the download loop, ~4 lines):

```ts
let currentHeaders = headers                                   // NEW
...
while (spec.redirect === 'follow') {
  const hop = redirectHop(...)
  if (hop === undefined || hops >= MAX_REDIRECT_HOPS) break
  scope.assert(hop.url, owner, `${tool}(redirect hop ${hops + 1})`)
  const fromUrl = currentUrl                                   // NEW: before reassignment
  hops++
  currentUrl = hop.url
  currentHeaders = crossHostHopHeaders(headers, currentUrl, fromUrl)   // NEW
  if (hop.get) { currentMethod = 'GET'; currentData = undefined }
  response = await client.fetch(currentUrl, { method: currentMethod, headers: currentHeaders, ... })
}
```

**Test to add to the existing spec** (`redirect hops: browser transport guards hops the same way`): give it an
`auth` header and a mock `client` that records `headers` per URL, then assert the cross-host hop has **no**
`authorization` key while the same-host hop still does. The current test asserts scope only, which is exactly why
a green suite coexisted with the leak — a regression test that mirrors the assertion, not just the invocation.

**Why it matters despite scope holding:** the leaked host is still inside the engagement scope, so this is not a
scope escape — it is a credential-hygiene bug. Real briefs routinely scoped `app.` + `admin.` + a CDN together
(the run-9 motivating case was an in-scope `/admin` 302-ing to `admin.atlassian.com`), and a token minted for one
of those hosts, sent to another, is precisely the cross-host credential reuse the fix was meant to stop. Severity:
low on its own; the reason to fix now is that the guarantee is stated absolutely ("every HTTP transport") and a
future lane will rely on it.

**Wording suggestion:** claim it per transport until it is uniform — "jar + download transports drop
`Authorization` on cross-host hops; the browser transport does not yet" is a sentence nobody can misread into a
false green.

---

## 3. Two behaviours worth knowing (not defects)

- **`diff_pair` (and other ≤legs) do not follow redirects unless asked.** A probe/miss pair pointing at a
  redirecting endpoint returns the raw `302` twice and resolves `NOT_FOUND` → `INCONCLUSIVE`. That is honest and
  fail-safe, but if a leg spec omits `redirect`, a user may read "NOT_FOUND" as "object missing" when the real
  story is "this URL redirects". Consider a one-line note in the verdict text when the probe status is 3xx.
- **Binary suppression is transport-agnostic** — the browser transport's result goes through the same renderer,
  so `body: (binary application/pdf — preview suppressed …)` appears for both. Good: one place to maintain.

---

## 4. The lesson I would keep from this round

The run-9 changes were broad and most of them landed. The single miss came from a **claim wider than its test**:
the new browser-hop test exercised the scope assertion and passed, while the sentence around it promised header
stripping too. When a bullet lists two guarantees ("scope-asserts each `Location`" **and** "drops the
Authorization header"), it needs one assertion per guarantee — otherwise the suite certifies half a sentence.

---

## 5. Verified and closed (do not re-litigate)

`context_status` on rc.2 · out-of-scope redirect hop denied pre-connection + audited label ·
in-scope cross-host hop followed with hop count · jar cross-host `Authorization` dropped ·
same-host control preserved · browser hop scope gating · `browser_navigate` / `tab_open` fail-closed with
`about:blank` and no far-host content in the transcript · `session_verify` proof gate fails closed (no false
green) · `http_download {browser}` + final-URL filename · binary preview suppression on both transports ·
DBSC four branches + no phantom warning on a clean profile · focus watchdog (95 ms steal, restored, human's own
windows untouched) · 36 px bottom park on the spawn path · 76/76 tests.

## 6. Human-side, one action

`web_search` still has no key. The new error names all three routes, which is the right shape — but it needs the
key stored once on the TUI **Models** page (or `DEEPSEEK_API_KEY` in the launcher env). No code change.
