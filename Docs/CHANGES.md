# Modified files (vs upstream pin 2957277)

House rule: one line per file, why it changed. New upstream pins re-apply
this list. Commits and pushes follow the AGENTS.md commit style
(`Type: summary` + `- [x]` checklist + `Verified:` paragraph).

## 2026-10-26 — comet transcript & sidebar pass (tool tones, final summary, mascot)

| File | Why |
|---|---|
| `src/theme.ts` | `toolNameSearch`/`toolNameMcp` tokens in every built-in; exec green (distinct from Read cyan) |
| `src/components/messages/toolTone.ts` (new) | family mapping + family colour token + per-family card wash blended from the theme's own surface |
| `src/components/ToolUseLoader.tsx` | status dot follows the same family token (Read/Grep/Pwsh/MCP differ) |
| `src/components/messages/AssistantToolUseMessage.tsx` | Read/Grep join the one-line card mode; persistent `▸`; family colour + wash; header title flattens newlines and truncates before it can wrap (MCP code args / terminal scripts) |
| `src/components/sidePanel/PanelBar.tsx` | navigator contract: `◀ icon Title ▶` only (no tab-icon fan), count/badge on the active title |
| `src/components/sidePanel/SidePanelColumn.tsx` | brand header = 22×16 mascot beside the wordmark (one-cell gap), click cycles the mascot; 8 rows + 1 gap on tall/wide panels, text-only 2 rows + gap otherwise; host height follows |
| `src/components/sidePanel/SidePanelLayout.tsx` | divider junction rows follow `sidebarBrandRows(rows, panelColumns)` |
| `src/components/sidePanel/sidebarBrand.ts` (new) | mascot variants, width+height-aware `sidebarBrandRows`, persisted choice (`~/.dsh-tui/sidebar-logo.json`) |
| `src/components/sidePanel/SidebarMascot.tsx` (new) | whale-girl / pixel-whale sprite mode-sampled to a 22×16 logo box (compact 22×4 strip) |
| `src/components/Whale.tsx` | export `WHALE_PALETTE` for the sidebar's miniature whale |
| `src/components/SubagentDetailScene.tsx` | narrow-panel layout: one-line identity with truncation, status on its own row, compact tabs (no counts), one-line footer |
| `src/components/MessageList.tsx` | display-only final-summary lift (newest turn waits for agent idle), signature/cache keys, row render |
| `src/components/messages/FinalSummaryRow.tsx` (new) | collapsed `✓ Final summary` line; click/Ctrl+O expands to Markdown |
| `src/adapter/ports/channel-view.ts` | `ChatRow.finalSummary` display decoration (copy-on-write, never projection) |
| `src/screens/Chat.tsx` | passes `agentRunning` (turn-settled gate) to the transcript |
| `src/components/SubagentDashboard.tsx` | clears folded agents (`c` show/hide), single-line footer count, clears ignore running agents |
| `src/components/sidePanel/agentsPanelClear.ts` (new) | session-scoped fold set; show/hide flag |
| `src/components/sidePanel/builtinPanels.tsx` | auto-folds finished agents after the work settles (4s grace); wires `c` |
| `src/settings/definitions.ts` | one-line-cards hint covers Read/Grep |
| `src/i18n.ts` | final-summary, cleared-agents, and compact subagent-tab keys (zh/en) |
| `scripts/verify-side-panel-layout.tsx` | locks the new bar/brand/junction contract at 40 rows |
| `scripts/verify-side-panel-mouse.tsx` | navigator arrow contract replaces the icon-fan tests |
| `scripts/verify-side-panel-registry.tsx` | active-only bar + keyboard panel routing; Info stub gains `mcpStatus`/jobs/notifications |
| `scripts/verify-agents-side-panel.tsx` | 26-row fixture for the compact brand header; cleared-agent fold/show checks |
| `scripts/verify-tool-card-completeness.tsx` | pins `oneLineToolCards: false` (that script tests bodies) |
| `scripts/verify-comet-transcript.tsx` (new) | final-summary lift, one-line cards, tone families |
| `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md` | site-teammate cap 3 → 10 |
| `C:\Code\Bug_Bounty\AGENTS.md` §8.1 | deployed copy of the same cap change (outside this repo) |
| `~/.dsh/profiles/dsh-tui/cordis.patch.yml` | `agent-team` override `maxMembers: 11` (10 teammates + Lead; bundle said 8) |

Follow-up hardening (same pass):

| File | Why |
|---|---|
| `src/components/sidePanel/InfoPanel.tsx` | session/agent id rows survive partial fixture channels (`typeof` guard before `.slice`) |
| `src/components/messages/AssistantToolUseMessage.tsx` | SendMessage relay cards keep their preview body under one-line mode (the message + summary IS the card) |
| `scripts/verify-side-panel-resize.tsx` | frame helper derives the divider tee from `sidebarBrandRows` (brand header moved the top tee) |
| `scripts/verify-toolcard-i18n.tsx` | preview-contract scenarios + header-split check pin `oneLineToolCards: false` (fork default hides bodies by design) |
| `scripts/verify-agent-view-ui.tsx` | Chat phase closes the side panel (fork boots open; the phase pins full-width-chat + fullscreen-dashboard contracts) |
| `vendor/dsh-tui/cordis.patch.yml` + `patch-surface.snapshot.json` | dropped the `tool-ralph` disable row (0.2.x runtime no longer registers the entry — the row only logged `patch: entry not found` at boot); snapshot regenerated |

Known environment noise (not fork code): `dsh --profile dsh-tui` still logs one
`patch: entry "tool-ralph" not found` at boot. Source: the profile resolves
the fork's `@deepseek-ai/dsh-web-app` peer from the stale shared
`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-web-app@0.1.0-rc.6`, whose own
patch still disables `tool-ralph`. Harmless; refreshing that shared package
(or a future dsh CLI update) clears it.

## 2026-10-26 — model-facing context tools + desktop shortcut

- `plugins/dst-comet-agent-tools/` (new out-of-tree dsh bundle, installed in
  the profile): `context_status` (agent reads its own context usage — used
  tokens, window, %, auto-compact trigger from `tokenMeter`) and
  `session_compact` (agent-initiated compaction: schedules
  `ctx.compaction.compactNow` for the turn's end via `agent.whenIdle()` with
  a busy-retry, since compaction requires an idle agent). Vendored dep
  `@deepseek-ai/dsh-tools@0.2.1-rc.2`; `engines.dsh` gates compatibility.
  Stock DSH exposes NEITHER to the model (token meter is UI-only; compact is
  human `/compact` only).
- Desktop: `DST-Comet.lnk` (cmd /k dstc) + generated `assets/dst-comet.ico`
  (comet head+tail, mist-blue); icon also installed to `~/.dsh/icons/`.

## 2026-10-26 — comet theme + prose palette + agent-team orchestration

- `src/theme.ts`: 8 new Theme keys (method pills ×6, proseStrong,
  proseQuote) across all built-ins; new `comet` theme (soft body text,
  white bold, pink quotes); vivid-diff base inherited. Registered in
  THEME_NAMES/getTheme/themeCatalog.
- `src/themeCatalog.ts`: comet base role.
- `src/terminal-utils/markdown.ts`: HTTP-method prose coloring
  (CometStream's path-lookahead guard), curly-quote spans, theme-gated
  bold; no-op (byte-stable) for themes whose tokens equal `text`.
- `cordis.yml`: compact thresholdRatio default `0.2 → 0.45`.
- Profile: `dsh-experimental-agent-team-profile@0.2.1-rc.2` added;
  `~/.dsh-tui/theme.json` preset to `comet`.
- `orchestra/BUG_BOUNTY_TEAM_PROTOCOL.md`: reusable Mother-mode protocol
  (deployed into the Bug_Bounty workspace's AGENTS.md §8).
- Gates: 13 markdown/theme gates pass; full verify:build re-run.

## 2026-10-26 — recheck pass (bug fixes)

- `AssistantToolUseMessage.tsx`: one-line suppression now skips RUNNING cards
  (the running-elapsed line and live-output window are the only progress
  feedback; suppression also killed pending write previews mid-call).
- `InfoPanel.tsx`: MCP rows parsed by segment (`name · status · tools`) with
  exact status matching — the first cut's substring test painted
  `disconnected` green; server names are now row labels, notes render dim.
- `SidePanelColumn.tsx`: `installedTuiVersion()` memoized (it reads installed
  files; the column re-renders on every channel emission).
- Profile install flow: the tarball now lives at `dist/dst-comet.tgz`
  (persistent — the profile's `file:` dependency resolves it on future
  plugin operations); `install-fork.bat` packs with pnpm 11 + hoisted
  linker (pnpm 12 refuses bundledDependencies).
- `bin/dstc`: POSIX arg rebuild instead of eval string; `.gitattributes`
  pins LF for shell launchers.
- Gates: `typecheck` + full `verify:build` suite run clean on the fork.

## 2026-10-26 — first feature pass

| File | Why |
|---|---|
| `src/tuiDisplayPrefs.ts` | side panel opens by default (`sidePanelOpenStore` false→true) |
| `src/components/sidePanel/SidePanelColumn.tsx` | DST Comet brand header (2 rows) above the panel tab bar |
| `src/components/sidePanel/InfoPanel.tsx` | MCP section fed by `channel.mcpStatus()` |
| `src/adapter/ports/channel-ui.ts` | port: `oneLineToolCards` + `setOneLineToolCards` |
| `src/adapter/channel/ui-policy.ts` | classify the new property/setter |
| `src/dsh-adapter/channel/state.ts` | state field + initializer (default on) |
| `src/dsh-adapter/channel/preferences.ts` | `setOneLineToolCards` impl |
| `src/dsh-adapter/index.ts` | Config schema `oneLineToolCards` default true + doc |
| `src/dsh-adapter/plugin.ts` | settings schema, channel seed, apply, /settings field, settings type |
| `src/settings/definitions.ts` | `oneLineToolCards` setting entry (sorted position) |
| `src/screens/Chat.tsx` | pass `oneLineToolCards` to MessageList |
| `src/components/MessageList.tsx` | thread the prop (types, defaults, height signature) |
| `src/components/messages/TranscriptLeaves.tsx` | thread the prop to subagent tool cards |
| `src/components/messages/AssistantToolUseMessage.tsx` | one-line collapse behavior (terminal/generic, not errors/diffs) |
| `src/components/messages/AssistantThinkingMessage.tsx` | thinking header line-count stat |
| `src/i18n.ts` | keys: `thinking-lines`, `info-section-mcp` |
| `src/theme.ts` | vivid diff colors in `darkTheme` |
| `vendor/dsh-tui/pnpm-lock.yaml` | pnpm 12 specifier normalization (`workspace:*`→`workspace:^`), incidental |

## Repo scaffolding (not upstream files)

`bin/dstc.cmd`, `bin/dstc` (launchers) · `scripts/setup-vendor.sh`,
`scripts/install-fork.bat` (setup/install) · `VENDORED.md` (pins) ·
`Docs/DESIGN.md` (this design map).
