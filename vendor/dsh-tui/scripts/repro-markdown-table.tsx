/**
 * Markdown table layout in the split (side-panel) transcript.
 *
 * User ask 2026-11-18 (screenshot of a 3-column status table next to the
 * side panel): the grid lost its right border and box corners on EVERY
 * line, status cells squeezed into ~40 chars with dangling-quote wraps, and
 * 1-line cells floated to the MIDDLE of 3-line rows.
 *
 * Two contracts, pinned here against the component directly (no Chat —
 * same xterm harness as repro-askpanel):
 *  1. WIDTH: every rendered line fits the printable transcript width —
 *     terminal minus the permanent 2-column gutter (RAIL_WIDTH) minus
 *     SAFETY_MARGIN — so the right border/corners can never be clipped by
 *     the column box.
 *  2. ALIGNMENT: cells are top-aligned — the FIRST line of a row carries
 *     every cell's first line (a 1-line row number sits beside line 1 of
 *     its 3-line finding, not beside line 2).
 *
 * Run: node --import tsx/esm scripts/repro-markdown-table.tsx
 */
process.env.FORCE_COLOR = '3'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render }, { MarkdownTable }, { TerminalSizeContext }, { stringWidth }, { viewportLines, settled }] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/components/MarkdownTable.js'),
  import('../src/ink/components/TerminalSizeContext.js'),
  import('../src/ink/stringWidth.js'),
  import('./lib/term-test.mjs'),
])

const COLS = 164 // narrowed chat column from the screenshot's split layout
const ROWS = 30

const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 400, allowProposedApi: true })
class FakeStdout extends Writable {
  columns = COLS
  rows = ROWS
  isTTY = true
  _write(chunk: unknown, _e: BufferEncoding, cb: () => void) { term.write(String(chunk), cb) }
}
class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}
const screen = (): string => viewportLines(term, ROWS).join('\n')

const cell = (raw: string): { type: 'text', text: string, tokens: Array<{ type: 'text', raw: string, text: string }> } =>
  ({ type: 'text', text: raw, tokens: [{ type: 'text', raw, text: raw }] })

/** The lost-list shape: tiny id column, long finding, long status. */
const token = {
  type: 'table' as const,
  align: [null, null, null],
  header: [cell('#'), cell('Finding (original)'), cell('Status')],
  rows: [
    // Row 1: 1-line id + 1-line finding + 3-line status — tall enough that
    // vertical centering would push the id down to the row's middle line
    // (2-line rows hid the bug: floor((2-1)/2) = 0 still looks top-aligned).
    [cell('1'), cell('digest_domains accepted only bare hosts'), cell('FIXED — normalizeHostInput (cookies.ts:234-256), live-verified across scheme, port, path and leading-dot input forms that used to silently match nothing')],
    [cell('2'), cell('Lookalike host classifies VENDOR-PLATFORM (unanchored regex)'), cell('OPEN — session.ts:109 unchanged')],
  ],
}

await render(
  // useTerminalSize throws outside an App — provide the context explicitly
  // (the split layout provides it narrowed to the chat column; COLS here).
  React.createElement(TerminalSizeContext.Provider, { value: { columns: COLS, rows: ROWS } },
    React.createElement(MarkdownTable, { token: token as never, highlight: null, forceWidth: COLS })),
  { stdout: new FakeStdout() as never, stdin: new FakeStdin() as never, stderr: new FakeStdout() as never, debug: true, exitOnCtrlC: false },
)

let failures = 0
const results: string[] = []
const check = (name: string, ok: boolean, extra = ''): void => {
  results.push(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures += 1
}
// patchConsole routes console.* through the renderer; report on the raw
// stream so the harness output survives.
const report = (text: string): void => { process.stdout.write(`${text}\n`) }

await settled(() => screen().includes('Finding') && screen().includes('digest_domains'))
const lines = screen().split('\n').filter(line => line.trim() !== '')
const grid = lines.filter(line => line.includes('│'))
const rules = lines.filter(line => /^[┌├└]/.test(line))

// 1. WIDTH — nothing exceeds printable = COLS - SAFETY_MARGIN - RAIL_WIDTH.
const printable = COLS - 4 - 2
const widest = Math.max(...lines.map(line => stringWidth(line)))
check('rendered a grid (not the vertical fallback)', grid.length > 0, `${grid.length} grid lines`)
check('every line fits the printable width', widest <= printable, `widest ${widest} of ${printable}`)

// 2. RIGHT BORDER — every grid line and rule closes its box.
check('every grid line ends with the right border', grid.length > 0 && grid.every(line => line.trimEnd().endsWith('│')),
  `${grid.filter(l => !l.trimEnd().endsWith('│')).length} open of ${grid.length}`)
check('every rule carries its right corner', rules.length === 4 && rules.every(line => /[┐┤┘]$/.test(line.trimEnd())), `${rules.length} rules`)

// 3. TOP-ALIGN — row 1's FIRST content line carries id + finding + status
// together (centering used to push the id down to the row's middle line).
const firstBodyLine = grid.find(line => line.includes('digest_domains'))
check('row 1 starts top-aligned (id + finding + status on line 1)',
  firstBodyLine !== undefined && firstBodyLine.includes('1') && firstBodyLine.includes('digest_domains') && firstBodyLine.includes('FIXED'))
const row2Index = grid.findIndex(line => /^\│\s+2\s+\│/.test(line))
const row2Continuation = row2Index >= 0 ? grid[row2Index + 1] : undefined
check('a 1-line id does not repeat on continuation lines', row2Continuation === undefined || !/^\│\s+2\s+\│/.test(row2Continuation))

report(results.join('\n'))
report(failures === 0 ? 'repro-markdown-table: ALL PASS' : `repro-markdown-table: ${failures} FAIL`)
process.exit(failures === 0 ? 0 : 1)
