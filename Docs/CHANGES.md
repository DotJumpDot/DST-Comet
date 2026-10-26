# Modified files (vs upstream pin 2957277)

House rule: one line per file, why it changed. New upstream pins re-apply
this list.

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
