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

## 6. ⬜ Colorful transcript (CometStream-classic palette)

Requirements captured: inline code / API paths **keep** the current blue
(`theme.permission` — `terminal-utils/markdown.ts` paints inline code with
it; do not touch). What remains:

- A `comet` built-in theme (`theme.ts` + `themeCatalog.ts` role) with a
  richer token palette: distinct colors for paths, quoted values, commands
  in prose (the pic-7 look), while links keep accent blue.
- Possibly extend `markdown.ts` colorization for prose-embedded paths and
  quoted strings (currently only inline code + links are colored).
- HTTP method badges (`GET/POST/…`) exist nowhere in a TUI transcript —
  only inside fenced code blocks, where `syntaxTheme.ts` governs. Decide:
  keep syntax colors, or add a method-token color.

## 7. ⬜ Splash / branding

`branding.ts` + `LogoV2.tsx` compose the boot splash per brand
(words, pixel art, layout ladder). A full "DST Comet" brand (own splash
words + art skin) means extending `Brand`, `BRAND_SPLASH_WORDS`,
`BRAND_THEMES`, `brandOfBackend`. The sidebar header (item 1) is the first
piece of that identity.

## Verify loop (Windows)

```sh
cd vendor/dsh-tui
npm run compile:src                                   # tsc
npx -y pnpm@11.21.0 pack --config.nodeLinker=hoisted  # pnpm 12 refuses bundled deps
dsh plugin --profile dsh-tui add <tgz>                # install into profile
dstc                                                  # launch
```
