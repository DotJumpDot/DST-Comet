# Notes — 2026-11-11: Constellation Chrome RAM investigation (run 39, live mid-run)

Investigated read-only during the live run (nothing installed, nothing killed by
the agent). All numbers captured 22:44–22:49 local (+07).

## TL;DR

- The "8 GB / 4 GB" Chromes you saw were **lane browsers**. One lane —
  `r39-mtree2a` (marketplace-tree crawler) — balloons a single renderer to
  **6+ GB within minutes**; you killed it, the lane relaunched it, twice.
  **It is alive right now** (spawned 22:40, ~10 GB total at 22:48, still growing).
- The rest is the by-design cost of per-owner browser isolation: 12–13 lane
  Chromes × ~0.3–0.8 GB ≈ 5–8 GB baseline. Normal, not a leak.
- Constellation node server itself is at **3.0 GB** — no diagnosis yet, watch it.

## Live snapshot (22:48)

Machine: 6.0 GB free of 32.5 GB. chrome.exe total **14.4 GB / 108 processes**.

| Chrome (by user-data-dir) | RAM | Notes |
|---|---|---|
| `Constellation\cdp-r39-mtree2a` | **10.0 GB** | 9 procs; renderer 6.37 GB (grew +1.7 GB in ~3 min — actively ballooning), network utility 1.63 GB, browser main 2.47 GB. Spawned 22:40:09. |
| your own Chrome (default profile) | 1.7 GB | no user-data-dir flag — not a lane |
| `cdp-r39-linktree` | 813 MB | |
| `cdp-r39-atl-inv-b` | 787 MB | 1 tab parked on Atlassian email-verify |
| `cdp-r39-meraki` | 566 MB | |
| `cdp-r39-pantheon-v2` | 322 MB | 2 tabs, healthy |
| `cdp-r39-atl-inv` | 95 MB | |
| `cdp-r39-asana2` | 59 MB | **zombie** — CDP port 9333 dead, main pid alive |
| `cdp-r39-mtree2` | 42 MB | |
| shared `dsh-bug-bounty` | 39 MB | idle |

Node side: constellation `cli.js` **3.07 GB**, dsh host 2.47 GB.

## What the 10 GB one is (mechanism)

- Launched by **our own `browser_launch {user_data_dir}`** — a Playwright
  persistent context (parent = the constellation node process; debugging rides
  a pipe, not a port). Profile dir is the lane recipe's
  `%LOCALAPPDATA%\Constellation\cdp-<owner>`.
- Audit log (`scope-audit.jsonl`) shows the respawn loop, answering "did it
  spawn new already": **3 launches in 31 minutes — 22:09, 22:31, 22:40 local.**
  Your kills sit between them; the lane's next tool call relaunches on the same
  profile, and the workload re-balloons within minutes. Killing it again
  without changing the lane's method = temporary.
- The profile on disk is only **37 MB** → the 10 GB is pure in-memory page
  bloat: the lane accumulates its crawl in ONE tab (in-page JS heap / DOM),
  which also explains the 1.6 GB network-service utility.
- Not a Constellation regression from today's round: `browser_launch` +
  `user_data_dir` is the pre-existing run-7 tool; today's plain-launch path is
  not involved in this case.

## What is already in place (no action needed)

- **Idle sweeper IS active** (`IDLE_TIMEOUT_MIN` default 45 min, bumped by
  tool use): inactive lane browsers get closed on their own after 45 min —
  that's why the fleet isn't bigger.
- `registry.launchFor` closes the previous session before replacing it — no
  session-object leak on relaunch.
- Today's churn for scale: 65 `browser_launch` + 40 `browser_launch_plain`
  (105 lane-browser launches in one evening).

## You can do RIGHT NOW (no install)

1. `r39-mtree2a` is the fire. Have the Lead tell that lane to **stop
   accumulating in one tab** (navigate per page / close extra tabs / chunk its
   tree walk) or park the lane. `taskkill /PID 33268 /T` kills the tree now —
   but expect a respawn on that lane's next browser call until its method
   changes.
2. The `r39-asana2` chrome is a zombie (CDP already dead) — safe to kill
   anytime.
3. Baseline (5–8 GB across 12–13 active lanes): the Lead's "close unused
   chromes" instruction is the right lever; the sweeper handles the rest.

## Update 22:56 — the dstc TUI lag checked: it is memory thrash

User reported the running `dstc` feels laggy. Measured live (6 s two-snapshot
probe, read-only):

- **Available RAM: 850–1008 MB of 32.5 GB. Commit charge 85.6 of 86.9 GB
  (98% of the limit)** — the pagefile is nearly exhausted; when it fills,
  allocations start failing (Chrome tabs crash, node OOMs).
- **Hard faults 6.5k–12.3k pages/sec** — the box is thrashing. Page-in stalls
  hit every process including the TUI: that IS the lag, system-wide, not a
  TUI-render bug.
- CPU too: dstc TUI host **329% of one core** (14 threads, WS 2.2 GB),
  constellation node 172% (WS 2.9 GB), chrome fleet 921% — on 16 logical
  cores, ~90% saturation at peak.
- `mtree2a` grew **10.0 → 11.96 GB in ~40 min** and is still the hog; four
  MORE lane chromes spawned since 22:48 (atl-inv-d, canva, quizlet, atl-inv-c).
- Session logs: no file >15 MB — not a factor.

Conclusion: kill or fix the `mtree2a` lane browser (~12 GB back) and the TUI
should feel snappy again. If lag persists AFTER RAM is freed, that is the
`--cpu-prof` profiling round (329% single-process burn would then be real
TUI-side work to pin).

## Parked for the next round (needs install — waiting for green light)

1. **`browser_map` RAM column** — per-owner total MB, tab count, biggest
   renderer MB, zombie (dead-CDP) flag, reusing the `runningProfileDirs`
   PowerShell pattern. Turns Task Manager archaeology into one tool call.
2. **RAM guard** — sweeper extension: warn (optionally auto-park) any session
   whose chrome RSS crosses a threshold (~2.5 GB). Catches runaway crawlers
   even while "active".
3. **Lane recipe fix** (Bug_Bounty spawn template, Lead's file): crawler lanes
   navigate-per-page and `browser_kill` at lane end.
4. **Disk reaper** — 498 owner profiles (~30+ GB) plus dozens of
   `Constellation\cdp-*` dirs from runs 33–39; add `profiles_reap
   {older_than_days}`.
5. **Constellation node heap watch** — 3.0 GB after ~3 h; if it keeps growing
   across the run, heap-snapshot it next round.
