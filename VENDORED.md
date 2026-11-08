# Vendored upstreams

This monorepo vendors two upstream projects. Upstream commit pins live here so
we can rebase our fork and track what we changed.

| Path | Upstream | Pinned commit | Date |
|---|---|---|---|
| `vendor/dsh-tui` | https://github.com/ccch1mneyyy/dsh-TUI | `224f847d02c2157f43862d2792cf9d7459222f4c` (tag v0.19.0) | 2026-11-06 |
| `vendor/deepseek-harness` (not tracked, local only) | https://github.com/deepseek-ai/deepseek-harness | `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` | 2026-10-23 |
| `engine/` (forked copy, tracked) | deepseek-harness tag `dsh-v0.2.2-rc.1` (`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`), `packages/experimental/{agent-team,tool-agent-team,agent-team-profile}` — fork versions `0.2.2-rc.1-comet.1` | `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` | 2026-11-09 |

Runtime pairing used for development: `@deepseek-ai/dsh@0.2.2-rc.1` (npm global)
against `dsh-tui` at the pinned commit (v0.19.0 declares engines back to
0.2.0-rc.1; the rc.2-era `stateOf` registry workaround in the engine fork is
retired — 0.2.2 publishes the `ProjectionHandle` API the journal now uses).

## Why deepseek-harness is not in git

It is ~103 MB of source that we treat as a read-only reference (plugin APIs,
agent-team service, tools). Our product changes are all inside `vendor/dsh-tui`.
`scripts/setup-vendor.sh` re-creates the checkout at the pinned commit.

The exception is `engine/`: the three Agent Teams packages we fork (see
`engine/README.md`) ARE tracked — they are small, they carry our orchestration
changes, and their fork versions must survive upstream re-pins.

## Re-vendoring at a new pin

```sh
rm -rf vendor/dsh-tui
git clone https://github.com/ccch1mneyyy/dsh-TUI.git vendor/dsh-tui
git -C vendor/dsh-tui checkout <commit>
rm -rf vendor/dsh-tui/.git
# update the table above
```
