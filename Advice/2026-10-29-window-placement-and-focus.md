# Advice: window placement + focus for spawned Chrome (2026-10-29)

> **STATUS 2026-10-30 (implementer): §4 COUNTER SHIPPED — Constellation
> `98c8cc6`, `src/browser/focus.ts`.** Armed before every Chrome spawn
> (captures the protect hwnd itself, handshakes ARMED, launch proceeds only
> then), polls at 40 ms for 10 s (spans spawn + park + info tab + the first
> navigation), matches ONLY processes whose command line carries this
> session's user-data-dir (IndexOf OrdinalIgnoreCase — the human's own
> Chrome and attach-mode windows can never be fought), restores via
> AttachThreadInput + SetForegroundWindow, and drops out after 2 counters so
> a deliberate human focus wins. Events append to `<rootDir>/focus-guard.log`
> (armed / STEAL / after-restore / drop-out lines — read that file after the
> next spawn to verify by evidence). `CONSTELLATION_FOCUS_GUARD=0` disables.
> Static + script-assembly tests landed (76/76) and a safe live probe armed
> and exited cleanly; the §6 focus acceptance (poll assertion on a real
> spawn) belongs to the next human run — watch focus-guard.log for the
> "STEAL … -> restoring" line. §5 residuals all stand: one-frame paint, DPI
> scaling of the peek, multi-monitor recompute at spawn, attach-mode never
> guarded.

**For:** the Constellation MCP implementer. **Source:** two human complaints (placement on 18:44, focus at
19:04) resolved the same evening by measurement on the human's own desktop. Everything below is a measured
number or a verified mechanism, not a preference guess.

**The two requirements, both from the human, both non-negotiable:**

1. **Placement** — a spawned Chrome is parked at the bottom edge of screen 2 (the left monitor) with only
   the tab strip visible, ~36 px. Deliberately hanging below the work area.
2. **Focus** — a spawned Chrome must never take the foreground from whatever the human is doing.

Placement is now correct in the build (`1600b9b`) and confirmed by the human. **Focus is still failing**,
and the earlier "`--start-minimized` fixes it" conclusion was wrong — see §3.

---

## 1. Placement — measured spec (confirmed)

Left monitor: `availLeft = -1920`, `availTop = 0`, `availW = 1920`, `availH = 1032`.

| property | value | note |
|---|---|---|
| `top` | `availTop + availH − 36` = **996** | peek height, from config |
| visible strip | **36 px** | the Chrome tab strip, clickable to restore |
| size | **945 × 1012** | unchanged; content lives below the edge |
| `left` | cascade from `availLeft` | measured gap 120–367 depending on owner — keep the cascade, it lines windows up sideways instead of stacking |
| state | `windowState: normal` | **not** minimized: the strip must be clickable |

Verified on both launch paths that used to disagree — `browser_navigate`/`browser_launch` and the
`session_keepalive` visit — all landing at `screenY 996`, `visibleStrip 36`, `IsIconic false`.

**Do not clamp the window fully on-screen.** That was an early wrong instinct; it undoes the whole point.
Guard only that the peek stays in a sane clickable band (20–60 px).

**Why the old code produced 43 px occasionally:** the anchor computed `top = availTop + availH − height`
with a height read before the window finished sizing. Peek must come from config, never from the window.

## 2. Placement — how to verify, not assume

From inside the page (works over CDP even while the window hangs off-screen):

```js
({ sx, sy, ow, oh } = await page.evaluate(() => ({
  sx: screenX, sy: screenY, ow: outerWidth, oh: outerHeight,
  availTop: screen.availTop, availH: screen.availHeight, availLeft: screen.availLeft,
})))
visibleStrip = availTop + availH - sy      // 36 = correct
```

`visibleStrip = 1012` means it opened full-height at the top (regression). `43` means a stale-height
anchor. The `--window-position` flag on the command line is **not** proof of placement — measure.

## 3. Focus — the measurement that settles it

A single `GetForegroundWindow` after a spawn is **invalid**: Chrome steals the foreground and then yields
it on its own ~2 s later, so a late snapshot reads "unchanged" while the human felt the steal. Poll at
100 ms *through* the spawn:

```
 0.02s  fg '? ?? Continue Bugcrowd Run 6 Handoff'   (human's TUI, pid 1972)
 8.46s  fg 'about:blank - Google Chrome'            <-- STEAL at window creation
 9.00s  fg '[focus-e] info — no job set - Google Chrome'
10.55s  fg '? ?? Continue Bugcrowd Run 6 Handoff'   (self-returned)
```

**No launch flag prevents it.** `--start-minimized` was tested and still steals. Nothing in the harness
calls `bringToFront`; a background process cannot legally take the foreground, but Chromium's own
window-show does.

**`CONSTELLATION_START_MINIMIZED=1` is not the answer either** — the current park helper skips minimized
starts ("minimized starts excepted"), so the window would stay taskbar-only and lose the tab-strip peek the
human wants.

## 4. Focus — the counter that works (verified by the human)

A short **post-spawn focus watchdog**: capture the foreground before launching, poll fast, and when the
foreground becomes a window of the Chrome just spawned, hand the foreground back.

```
watchdog: protecting hwnd=526522 '? ?? Continue Bugcrowd Run 6 Handoff'
  5.34s STEAL by hwnd=855254 '[focus-g] [focus-g] - Google Chrome' -> restoring
        after restore: hwnd=526522 '? ?? Continue Bugcrowd Run 6 Handoff'
watchdog end — steals countered: 1
```

The human, watching their own screen, called it flawless: the window still appeared parked at the peek and
their focus never left the TUI.

Plain `SetForegroundWindow` is refused to a background process, so the restore must attach thread input:

```csharp
me = GetCurrentThreadId();
fgT = GetWindowThreadProcessId(GetForegroundWindow(), out _);
tgT = GetWindowThreadProcessId(target, out _);
AttachThreadInput(me, fgT, true);
AttachThreadInput(me, tgT, true);
SetForegroundWindow(target);
AttachThreadInput(me, fgT, false);
AttachThreadInput(me, tgT, false);
```

**Implementation constraints**

- Hook it after **every** activating step, not just launch: info-tab creation, the `setWindowBounds` park,
  and the first navigation each re-show the window and can each re-take the foreground.
- Capture the target hwnd immediately **before** the spawn; poll ~40 ms for 3–5 s; stop on first restore.
- Match only windows belonging to the Chrome **you** just launched (its pid / user-data-dir). Never fight a
  window the human opened — if the human activates your window deliberately, drop out.
- Run it in the host process (or a small helper), not in the page context.
- Keep it cheap: it is a few dozen syscalls over a few seconds, once per spawn.

## 5. Residuals to document honestly

- **One-frame paint.** The window may still render for a frame before the restore lands; on a slow machine
  a flash is possible. The only truly windowless option is `--headless=new` — which kills the tab-strip
  peek the human asked for, so it is not the default.
- **DPI.** Coordinates above are 100 % scaling. Scale the peek with the monitor DPI rather than assuming 36.
- **Multi-monitor** reconfiguration (monitor unplugged, resolution changed) can invalidate `availLeft`;
  recompute from `Screen.AllScreens`/`screen.avail*` at spawn time, not from a cached constant.
- **Attach-mode windows** (`browser_attach`) belong to the human — never park or refocus those.

## 6. Acceptance tests a verify gate should assert

1. Placement: spawn an owner, read back `visibleStrip` — must be the configured peek ±2 px, on the
   secondary monitor, `windowState` normal.
2. Placement uniformity: the same assertion for a `session_keepalive`-launched window (that path is where
   the 43 px bug lived).
3. Focus: capture the foreground hwnd, spawn, poll 3 s — the foreground hwnd must never be a window owned
   by the new Chrome pid. Assert on the poll, never on a single post-spawn reading.
4. No regressions: `browser_navigate`, `browser_upload`, and tab creation must all satisfy 1 and 3.
