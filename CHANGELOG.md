# Changelog

## 2026-10-26 — repo born

- Vendored `dsh-tui` (upstream pin `2957277`) and `deepseek-harness`
  (reference only, pin `22ddee37`).
- Added `dstc` launcher, setup scripts, design docs.
- Roadmap: persistent right sidebar (MCP/agents/context + todos), one-line
  tool-card collapse, vivid diff colors, thinking stats, CometStream-classic
  transcript palette.

## 2026-10-26 — first UX pass

- One-line tool cards for Pwsh/Bash + MCP (`oneLineToolCards`, default on,
  full settings chain, click/Ctrl+O expands).
- Right sidebar opens by default; Info panel gains an MCP section; panel
  column gains the `◆ DST·Comet v…` brand header.
- Vivid diff colors in the default dark theme.
- Thinking header shows duration + line count.
