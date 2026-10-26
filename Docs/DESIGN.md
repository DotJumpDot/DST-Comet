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

## 3. ✅ One-line collapse + per-tool tones (Read / Grep / Pwsh / MCP)

New setting `dsh-tui.oneLineToolCards` (default **on**), full pref chain:

`dsh-adapter/index.ts` (Config schema, default true) → `plugin.ts`
(settings schema no-default, channel seed, apply `?? config ?? true`,
/settings field) → `channel-ui.ts` port + `ui-policy.ts` classification →
`state.ts` + `preferences.ts` (`setOneLineToolCards`) → `Chat.tsx` →
`MessageList.tsx` (threading + height signature) → `TranscriptLeaves.tsx` →
`AssistantToolUseMessage.tsx` behavior: collapsed terminal (Bash/Pwsh),
generic (MCP), Read and Grep/Glob/Search cards render the header line only;
the whole row stays click-to-expand (fullscreen) and Ctrl+O expands, and a
persistent `▸` marks the affordance. Error bodies and diffs keep the normal
collapsed shape.

The transcript used to paint every tool name and card face in one mist blue.
Now `components/messages/toolTone.ts` maps a tool to a family and a theme
token: Read → `toolDotRead` (cyan), Grep/Glob → `toolNameSearch` (violet),
Pwsh/Bash → `toolNameExec` (green), MCP → `toolNameMcp` (rose), Edit/Write →
`toolNameMutate` (gold), web → `toolDotWeb`, subagents/jobs → `toolDotTask`.
The card wash is that family colour blended into the active theme's own
`toolCardBackground*`, so subtle/strong still follow `/settings → toolBackground`
and every palette keeps its identity (ANSI themes keep their flat card shade).
`ToolUseLoader`'s status dot uses the same token.

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
- The bug-bounty workspace protocol (Mother coordinator, ≤10 fresh
  site-teammates, docs-only `researcher`, one-shared-browser/one-tab-each,
  ≤15-line messages, STATE.md-before-compaction, escalation) lives in the
  workspace's `AGENTS.md` §8 (auto-injected by agent-spine); a reusable
  copy ships at `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md`.
- Compaction threshold raised `0.2 → 0.45` (fork `cordis.yml`): sessions
  ride to ~450k of the 1M window before auto-compact — the user's
  "compact at a good checkpoint between 400–600k" preference.
- **Cap 3 → 10**: the protocol allows up to 10 concurrent site teammates
  (plus the Lead). The bundled agent-team profile sets `maxMembers: 8`, so
  the user profile patch overrides `agent-team` with `maxMembers: 11`
  (10 teammates + Lead; a profile override replaces the whole config block,
  so all four keys are repeated). Backend cap from `dsh-experimental-agent-team`
  `TeamRoster`; the TUI dashboard has no separate cap.

## 9. ✅ Side panel navigator + mascot header — 2026-10-26

- `PanelBar.tsx` is a navigator now: `◀ <icon> <Title> ▶` with the active
  panel's unread count, `⤢` on the right when the panel has a fullscreen
  form. The fan of every enabled panel's icon is gone — on a 30–50 col
  sidebar it read as a row of identical glyphs and never said which panel
  was active. Clicking an arrow cycles panels (same `onSelect` path as the
  host's ←/→ keys).
- `SidePanelColumn.tsx` brand header: a 22×16 pixel mascot (whale girl by
  default, DeepSeek pixel whale as the alternate) beside the two-line
  `DST·Comet v… / model · effort` wordmark, immediately after the art.
  Clicking
  the mascot cycles whale girl → whale → none and persists the pick to
  `~/.dsh-tui/sidebar-logo.json` (`sidebarBrand.ts` is a live store read with
  `useSyncExternalStore`). The mascot is a 22×16 sprite (8 text rows) on
  terminals at least 30 rows tall **and** panels at least 42 columns wide;
  otherwise the header is a text-only 2-row strip. A one-row gap always
  separates the brand block from the panel bar, so the bar/rule never jump.
- `SidePanelLayout.tsx` divider junctions follow
  `sidebarBrandRows(rows, panelColumns) + 1` and `rows - 2`.

- **Placement is a setting** (`dsh-tui.sidebarLogoPosition`, default
  `top`): `top` keeps the mascot beside the wordmark; `bottom` parks it
  centered at the panel foot above the hint row (own rows budgeted from
  the host, one breathing row under the panel content, same click cycle
  and the same ≥42-col width gate). Full pref chain like every display
  setting: Config schema → channel seed/apply → channel-ui port +
  ui-policy → state/preferences → Chat → SidePanelLayout (junction tees
  follow the text-only header height) → SidePanelColumn. The mascot
  VARIANT (girl/whale/none) stays the click-cycle file pref.

## 10. ✅ Final summary lifted above the workflow — 2026-10-26

`MessageList.tsx`'s visible-row pre-pass (`promoteFinalSummaries`) finds each
turn whose settled answer is the last assistant text after the last tool
call, and moves a shallow copy of that row under the user prompt with
`finalSummary: true`. This is a display-only reorder: the session log and
event order are untouched, and the flag is written copy-on-write (projection
rows are frozen). The newest turn waits for `agentRunning` to clear, so a
mid-turn assistant step does not flicker up before the model calls another
tool. `FinalSummaryRow.tsx` renders one success line
(`✓ Final summary · <first line> · N lines ▸`); click / Ctrl+O expands the
full Markdown, click again collapses. The height signature and the visible
cache key include the summary bit / agent-running state.

## 11. ✅ Agents tab clears finished agents — 2026-10-26

Once the lead is idle and no child is running, `builtinPanels.tsx` folds
settled subagents away after a 4s grace; a team's idle members are folded
too when its task board is finished (all tasks completed, at least one task).
`agentsPanelClear.ts` holds the session-scoped id set plus the
show/hide flag; `SubagentDashboard` hides folded ids only while they are
settled (a teammate that starts another run reappears immediately), shows a
quiet `○ N finished agents cleared · show (c)` line, and binds `c` to toggle.
Running/provisioning agents are never hidden. The channel roster, messages
and task board are unchanged — this is presentation only.

## 12. ✅ Subagent detail survives a 30–50 column sidebar — 2026-10-26

`SubagentDetailScene.tsx` now has a narrow layout (`columns < 64`) instead of
trusting a wide terminal:

- the identity line (`● Subagent: …`) keeps one row and truncates; the
  glyph/exit controls stay right-aligned;
- status + mode move to their own one-line row, so the description no longer
  gets squeezed into ~8 columns;
- model/duration/tokens/tools and started/id rows use `truncate-end`;
- the page tabs drop their counts and use short labels (`Sum`/`Out`/`Log`/
  `Tools`, zh equivalents) below 56 columns, and the row wraps by whole tabs;
- the footer collapses to `←/→ · ↑/↓ · X · Esc` on one truncated line.

## Verify loop (Windows)

```sh
cd vendor/dsh-tui
npm run compile:src                                   # tsc
npx -y pnpm@11.21.0 pack --config.nodeLinker=hoisted  # pnpm 12 refuses bundled deps
dsh plugin --profile dsh-tui add <tgz>                # install into profile
dstc                                                  # launch
```
