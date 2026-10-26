# DST Comet — UX design & implementation map

Baseline: dsh-TUI upstream pin `2957277` (see ../VENDORED.md). Every change
below lives in `vendor/dsh-tui/src/`. A running profile picks builds up via
`scripts/install-fork.bat` (pack → `dsh plugin --profile dsh-tui add`).

## Status legend

✅ done · 🚧 partial · ⬜ planned

## 1. ✅ Persistent right sidebar (OpenCode-style)

The upstream side-panel system (Ctrl+B, `components/sidePanel/`) already
provides the column, tabs, resize, persistence. What we changed:

- **Open by default**: `tuiDisplayPrefs.ts` `sidePanelOpenStore` default
  `false → true` (splitEnabled was already true). Ctrl+B still toggles.
- **MCP section**: `InfoPanel.tsx` gains an `MCP` section fed by
  `channel.mcpStatus()` (the same per-turn snapshot `/mcp` prints); rows
  color green on `connected`, amber on `needs-auth`.
- **Brand header**: `SidePanelColumn.tsx` renders a two-row
  `◆ DST·Comet v<version>` + `model · effort` header above the tab bar
  (the compact form of the boot splash's branding block).
- Agents (Ctrl+A → `agents` tab), todos, jobs, context usage were already
  panel tabs; with the panel open by default they are now always visible.

## 2. ✅ Todos in the sidebar (not above the input)

Already upstream: when the side panel is open and `todo` is enabled
(both default), the inline footer todo is suppressed (`Chat.tsx` guards on
`sidePanel.split && enabledPanelIds.includes('todo')`). Flipping the panel
default (item 1) moves todos out of the chat input area for free.

## 3. ✅ One-line collapse for Pwsh/Bash and MCP cards

New setting `dsh-tui.oneLineToolCards` (default **on**), full pref chain:

`dsh-adapter/index.ts` (Config schema, default true) → `plugin.ts`
(settings schema no-default, channel seed, apply `?? config ?? true`,
/settings field) → `channel-ui.ts` port + `ui-policy.ts` classification →
`state.ts` + `preferences.ts` (`setOneLineToolCards`) → `Chat.tsx` →
`MessageList.tsx` (threading + height signature) → `TranscriptLeaves.tsx` →
`AssistantToolUseMessage.tsx` behavior: collapsed terminal (Bash/Pwsh) and
generic (MCP) cards render header line only; click / Ctrl+O expands.
Error bodies, diffs, read/search previews keep the normal collapsed shape.
The whole row was already click-to-expand (fullscreen).

## 4. ✅ Vivid diff colors

`theme.ts` `darkTheme` (the default theme): pane backgrounds
`diffAddedDimmed/RemovedDimmed` `#2B352C/#362B2C → #1F3A29/#472129`, full
`diffAdded/Removed → #1D4630/#5C2430`, word colors
`#57956B/#B26671 → #4ADE80/#F87171` (GitHub-green/red vividness).
Other themes untouched.

## 5. ✅ Thinking line stats

`AssistantThinkingMessage.tsx`: the folded header now reads
`⚓ Thinking · 12s · 37 lines (ctrl+o to expand)` — duration was upstream
(settled, ≥1s), the line count is new (`thinking-lines` i18n key, zh+en).

## 6. ✅ Colorful transcript (CometStream-classic palette) — 2026-10-26

Implemented as a theme-system feature, not a fork of the renderer:

- **New `comet` built-in theme** (`theme.ts`, spreads `dark`): body text
  softens to `#C9C7C1` (the classic 80% white — bold pops instead of
  merging into a wall of white), bold emphasis `#FFFFFF`, curly-quoted
  spans pink `#F472B6`. Vivid diffs and the mist-blue accents inherit.
  Registered in `THEME_NAMES`, `getTheme`, `themeCatalog` (base role
  `dark`); `/theme` lists it next to `dark`; the user's `theme.json` is
  preset to `comet`.
- **8 new theme tokens** (`methodGet/Post/Put/Patch/Delete/Head`,
  `proseStrong`, `proseQuote`) across all 10 built-ins: dark family gets
  CometStream's pastel 300-series pills (GET `#7DD3FC`, POST `#6EE7B7`,
  PUT `#FCD34D`, PATCH `#C4B5FD`, DELETE `#FCA5A5`, HEAD `#A1A1AA`), light
  family the 700-series (`#0284C7`, `#059669`, `#D97706`, `#7C3AED`,
  `#DC2626`, `#52525B`), ANSI themes nearest 16-color equivalents.
  `proseStrong`/`proseQuote` equal to `text` render uncolored — every
  non-comet theme's output stays byte-stable (13 markdown/theme gates pass
  unchanged).
- **Prose colorization** (`terminal-utils/markdown.ts`): HTTP method words
  in plain prose colored per method — CometStream's exact guard
  (`\b(GET|POST|…)(?=\s+\/)`, so the verb "get" never matches; methods
  inside inline code keep the blue). Curly-quoted spans and bold via the
  theme tokens, no-op gated as above.
- **Kept blue**: inline code / API paths (`permission` token) untouched —
  the explicitly-kept DST look (user directive).

## 7. ⬜ Splash / branding

`branding.ts` + `LogoV2.tsx` compose the boot splash per brand
(words, pixel art, layout ladder). A full "DST Comet" brand (own splash
words + art skin) means extending `Brand`, `BRAND_SPLASH_WORDS`,
`BRAND_THEMES`, `brandOfBackend`. The sidebar header (item 1) is the first
piece of that identity.

## 8. Agent-team orchestration (bug-bounty "Mother" mode) — 2026-10-26

- `@deepseek-ai/dsh-experimental-agent-team-profile@0.2.1-rc.2` installed
  into the `dsh-tui` profile (persistent teammates = separate sessions with
  their own 1M contexts; `spawn_teammate`/`send_message`/task board replace
  the legacy one-shot subagents while mounted; TUI Ctrl+A shows the team
  view).
- The bug-bounty workspace protocol (Mother coordinator, ≤3 fresh
  site-teammates, docs-only `researcher`, one-shared-browser/one-tab-each,
  ≤15-line messages, STATE.md-before-compaction, escalation) lives in the
  workspace's `AGENTS.md` §8 (auto-injected by agent-spine); a reusable
  copy ships at `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md`.
- Compaction threshold raised `0.2 → 0.45` (fork `cordis.yml`): sessions
  ride to ~450k of the 1M window before auto-compact — the user's
  "compact at a good checkpoint between 400–600k" preference.

## Verify loop (Windows)

```sh
cd vendor/dsh-tui
npm run compile:src                                   # tsc
npx -y pnpm@11.21.0 pack --config.nodeLinker=hoisted  # pnpm 12 refuses bundled deps
dsh plugin --profile dsh-tui add <tgz>                # install into profile
dstc                                                  # launch
```
