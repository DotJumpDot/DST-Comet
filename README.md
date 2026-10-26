# DST-Comet

**DST** = **D**eep**S**eek **T**erminal — our UX fork of
[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), running the
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent
engine underneath. `dstc` launches it (**DST Comet**).

```
dstc  →  our dsh-tui fork  →  dsh harness (profiles, sessions, tools, agent teams)
```

## What we are changing (roadmap)

1. **Persistent right sidebar** (like OpenCode): MCP servers + status, agents /
   subagents, context usage — always visible, no more Ctrl+A/Alt+A only.
   Branded header (compact DST Comet splash) at the top of the sidebar.
2. **Todos move into the sidebar** — out of the chat input area.
3. **One-line collapse for tool cards** — `Pwsh` / `Bash` and `Mcp__*` calls
   render as a single clickable line; expand on click / `ctrl+o`.
4. **Vivid diff colors** — edit green/red backgrounds made saturated.
5. **Thinking line stats** — `Thinking (ctrl+o to expand) · 14s · 37 lines`.
6. **Colorful transcript** — CometStream-classic palette for commands, paths,
   values, HTTP methods; inline code / API paths keep DST's current blue.

Layout of the work: see [Docs/DESIGN.md](Docs/DESIGN.md) and
[AGENTS.md](AGENTS.md).

## Layout

| Path | What |
|---|---|
| `vendor/dsh-tui/` | **Our fork — all product changes happen here.** Vendored from upstream, `.git` stripped; pin in [VENDORED.md](VENDORED.md). |
| `vendor/deepseek-harness/` | Read-only engine reference, **not tracked in git** (see VENDORED.md). |
| `bin/` | `dstc` launcher (Windows `.cmd` + bash). |
| `Docs/`, `Picture/` | Design notes and screenshots. |

## Setup

Requirements: Node 20+, pnpm 10+, git, and a global `@deepseek-ai/dsh`
install (`npm i -g @deepseek-ai/dsh`) plus `DEEPSEEK_API_KEY`.

```sh
# 1. re-create the untracked harness reference checkout (optional, for API reference)
scripts/setup-vendor.sh

# 2. build the fork
cd vendor/dsh-tui
pnpm install          # runs prepare → compile (tsc)

# 3. get the launcher on PATH (writes dstc.cmd into %APPDATA%\npm)
scripts\install-launcher.bat    # or: copy bin\dstc.cmd anywhere on PATH
```

Then run `dstc` from any project directory.

## License

Our changes: MIT. Vendored code keeps its upstream licenses
(`vendor/dsh-tui/LICENSE`, `THIRD_PARTY_LICENSES/`).
