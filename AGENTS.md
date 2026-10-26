# AGENTS.md — working rules for this repo

## What this repo is

DST-Comet: a UX fork of dsh-TUI on top of the DeepSeek Harness (`dsh`) engine.
The launch command is `dstc`. All product work happens in `vendor/dsh-tui/`
(our fork). `vendor/deepseek-harness/` is a read-only API reference — never
edit or commit it (it is gitignored).

## Where things live in the fork (`vendor/dsh-tui/`)

- `src/` — TypeScript React (Ink) sources. `pnpm compile` emits `lib/`.
- `src/components/` — message/tool cards, diff renderer, chat transcript.
- `src/channel/` — session/event → view projection (source of truth = session log).
- `tui-profile/` — cordis profile glue, plugin contribution protocols.
- `cordis.yml` / `cordis.patch.yml` — plugin composition for the TUI profile.
- `docs/`, `guide/` — upstream architecture + plugin docs.

Build: `cd vendor/dsh-tui && pnpm install` (prepare → compile). Dev launch from
source: see `bin/dstc.cmd`.

## House rules

- Keep upstream file structure; make changes surgical and documented so we can
  rebase on new upstream pins. Record each modified file in `Docs/CHANGES.md`
  with a one-line reason.
- The session log is the source of truth; the TUI only projects it. Never fake
  state in the UI layer — read it from the channel projection.
- Windows is the primary platform (Git Bash + PowerShell). Test both collapse
  and diff rendering in Windows Terminal.
- Don't rename upstream exported APIs; add ours alongside (e.g. sidebar reads
  existing projections instead of forking them).
