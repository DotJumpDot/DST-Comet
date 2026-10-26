# Vendored upstreams

This monorepo vendors two upstream projects. Upstream commit pins live here so
we can rebase our fork and track what we changed.

| Path | Upstream | Pinned commit | Date |
|---|---|---|---|
| `vendor/dsh-tui` | https://github.com/ccch1mneyyy/dsh-TUI | `29572774890a4a89ae1fa562dd15a1ae21bb3593` | 2026-10-24 |
| `vendor/deepseek-harness` (not tracked, local only) | https://github.com/deepseek-ai/deepseek-harness | `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` | 2026-10-23 |
| `engine/` (forked copy, tracked) | same deepseek-harness pin, `packages/experimental/{agent-team,tool-agent-team,agent-team-profile}` | `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` | 2026-10-26 |

Runtime pairing used for development: `@deepseek-ai/dsh@0.2.1-rc.2` (npm global)
against `dsh-tui` at the pinned commit (which targets dsh `0.2.1-rc.2`).

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
