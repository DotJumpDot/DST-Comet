# DST-Comet engine fork — Agent Teams packages

This workspace forks the three experimental Agent Teams packages from
`vendor/deepseek-harness` (pin `22ddee37`, published upstream as
`@deepseek-ai/dsh-experimental-{agent-team,tool-agent-team,agent-team-profile}`
0.2.1-rc.3) so DST-Comet can ship orchestration improvements without
patching the globally installed `dsh`.

## Why a fork

`Advice/agent-team-hunt-run-2026-10-26.md` is a live-run log from a
6-teammate bug-bounty orchestration; it lists the harness gaps that cost
time. The upstream packages are published rc line artifacts and cannot take
our changes; this workspace carries the same package names at fork versions
(`0.2.1-rc.2-comet.1`) so a profile can swap upstream for the fork with one
`dsh plugin --profile <name> add <tarball>` (or a `file:` dependency), and
swap back by re-adding the official package. The official global `dsh`
install is never touched.

## Packages

| Package | What changed vs upstream 0.2.1-rc.3 |
|---|---|
| `agent-team` (service) | `SpawnTeammateRequest.agentOptions?: Readonly<AgentOptions>` — per-teammate provider/model/effort overrides, threaded into the subagent `startActivation` request (roster.ts). Journal reads state through the published `stateOf(session, key)` registry API (the vendored pin's `ProjectionHandle` design predates the published runtime). |
| `tool-agent-team` (tools) | 1) `spawn_teammate` gained `model` / `effort` params (cheap recon vs strong validation). 2) `team_snapshot` — one call returning per-member status, task load, who waits on a human, which lanes are frozen (replaces list_agents + team_task_list after every wakeup). 3) `human_task_create/list/resolve/wait` — the human task queue: a teammate parks itself at a captcha/login/email gate with click-by-click steps; further gated tool calls are REFUSED by a `ctx.tools.guard` until any member resolves; the queue mirrors onto the shared task board so the TUI shows it; every transition appends a JSONL audit line (`.dsh-human-tasks.jsonl`, config `humanTaskAuditPath`). 4) `lane_freeze` / `lane_resume` — Lead parks a teammate BETWEEN tool calls (guards run pre-dispatch, so the in-flight call finishes) without `interrupt_agent` cutting work mid-flight. |
| `agent-team-profile` (bundle) | Same composition; installs the forked pair. |

Fork deltas are marked `DST-Comet` in comments.

## Verify (no install needed)

```sh
cd engine
npx -y pnpm@11.21.0 install --config.nodeLinker=hoisted
npx -y pnpm@11.21.0 run verify   # typecheck (3 pkgs) + node:test 12/12 + tsdown builds
```

Tests never start an engine process: `tool-agent-team/tests/` drives `apply()`
over a fake cordis context built from the published rc.3 peer modules.

## Try it in a SEPARATE profile (later, deliberately not done yet)

```sh
cd engine/agent-team && npx -y pnpm@11.21.0 pack --config.nodeLinker=hoisted   # ×3 packages
dsh plugin --profile comet-test add <profile-bundle-tgz>   # the agent-team-profile bundle
dsh --profile comet-test                                    # try dstc against it
```

Revert any profile to upstream with
`dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-profile@0.2.1-rc.2`.
The running host pairs rc.2 == rc.3 bundles byte-for-byte, so the fork's
`-rc.2-comet.1` versions satisfy either.

## Compatibility notes

- Peer deps are pinned `0.2.1-rc.2 || 0.2.1-rc.3` — the profile's engine is
  rc.2, and the published rc.2/rc.3 agent-team bundles are identical, so the
  fork typechecks and runs against both.
- The vendored pin (2026-10-23) drifts from the published rc.3 in
  `session-projection` (ProjectionHandle → stateOf(session, key)) and one
  listener contract (`agent/created` handlers return undefined). The fork
  follows the PUBLISHED runtime, which is what every installed profile runs.
