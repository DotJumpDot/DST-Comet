# Modified files (vs upstream pin 2957277)

House rule: one line per file, why it changed. New upstream pins re-apply
this list.

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
