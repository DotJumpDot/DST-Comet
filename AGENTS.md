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

## Commit & push style (every commit, no exceptions)

Subject: `Type: summary (extra detail in parens)` — Type ∈ `Feat | Fix | Test |
Docs | Chore | Release` (bug-bounty sessions may use `Hunt | Report`). Body:
a `- [x]` checklist of what the commit actually did (one item per real
change, wrapped ~72 cols). Close with a `Verified:` paragraph naming the
checks that ran and their results. One push = one or more whole commits of
this shape; never mix types in one commit.

```
Fix: chapter date colors become a hue ladder (green -> yellow -> orange -> red -> grey)
- [x] User review: the grey buckets were indistinguishable on OLED
  themes and months-old vs 3-4-year-old chapters shared one bucket
- [x] New scheme: hue drift derived from the theme accent — <24 h the
  accent itself, this week -30 deg, this month -70 deg, this year
  -110 deg (heatmap toward warm), 1 year+ greys out

Verified: 290 tests green, analyze clean.
```

Tip: write the message to a file and `git commit -F <file>` — inline
heredocs through Git Bash can flatten newlines.
