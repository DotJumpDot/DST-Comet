/**
 * DST Comet transcript regression: in-place final summary + one-line tool cards.
 *
 * Locks the user-facing contract:
 *  1. a settled answer that follows tool work is marked as the final summary
 *     IN PLACE (end of the turn — where it streamed), ALWAYS EXPANDED
 *     (`✓ Final summary` header + the full Markdown body — the answer never
 *     folds and never teleports out of the viewport);
 *  2. the full body is hidden until expanded (Ctrl+O here) and comes back
 *     after collapsing;
 *  3. while a tool of the turn is still running, the answer stays unmarked;
 *     settling the tool promotes it;
 *  4. Read / Grep / Pwsh / MCP cards render their header line only, with a
 *     persistent disclosure affordance, and keep body text hidden.
 *
 * Run: node --import tsx/esm scripts/verify-comet-transcript.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'en'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render, AlternateScreen }, { Chat }, { QuestionStore }, { LOCAL_COMMANDS, completeCommands }, { settled, sleep }, toolTone, { getTheme }] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/commands.js'),
  import('./lib/term-test.mjs'),
  import('../src/components/messages/toolTone.js'),
  import('../src/theme.js'),
])

const COLS = 110, ROWS = 44
let failed = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failed += 1
}

const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
class FakeStdout extends Writable {
  columns = COLS; rows = ROWS; isTTY = true
  _write(chunk: unknown, _e: BufferEncoding, cb: () => void) { term.write(String(chunk), cb) }
}
class FakeStderr extends Writable { isTTY = true; _write(_c: unknown, _e: BufferEncoding, cb: () => void) { cb() } }
class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}
const stdin = new FakeStdin(), stdout = new FakeStdout(), stderr = new FakeStderr()

function screenLines(): string[] {
  const buf = term.buffer.active
  return Array.from({ length: ROWS }, (_, y) => buf.getLine(buf.baseY + y)?.translateToString(true) ?? '')
}
function screen(): string { return screenLines().join('\n') }
function rowOf(needle: string): number { return screenLines().findIndex(line => line.includes(needle)) }

const readTool = {
  callId: 'call-read', name: 'Read', argsText: '{"file_path":"src/app.ts"}', status: 'ok' as const,
  startedAt: 0, durationMs: 40,
  resultView: { card: 'read' as const, title: 'Read src/app.ts', path: 'src/app.ts', content: [{ type: 'text', text: 'READ-BODY-MARKER' }] },
  resultText: 'READ-BODY-MARKER',
}
const grepTool = {
  callId: 'call-grep', name: 'Grep', argsText: '{"pattern":"TODO"}', status: 'ok' as const,
  startedAt: 0, durationMs: 12,
  resultView: { card: 'search' as const, shape: 'matches' as const, title: 'Grep TODO', files: [{ path: 'src/a.ts', matches: [{ lineNumber: 1, line: 'GREP-BODY-MARKER' }] }], truncated: false, total: 1 },
  resultText: 'GREP-BODY-MARKER',
}
const pwshTool = {
  callId: 'call-pwsh', name: 'Pwsh', argsText: '{"command":"npm test"}', status: 'ok' as const,
  startedAt: 0, durationMs: 900,
  resultView: { card: 'terminal' as const, title: 'npm test\nSECOND-CMD-LINE', output: 'PWSH-BODY-MARKER' },
  resultText: 'PWSH-BODY-MARKER',
}
const mcpTool = {
  callId: 'call-mcp', name: 'mcp__playwright__browser_evaluate', argsText: '{"function":"() => 1"}', status: 'ok' as const,
  startedAt: 0, durationMs: 30,
  callView: { card: 'generic' as const, title: 'browser_evaluate' },
  resultView: { card: 'generic' as const, title: 'MCP browser_evaluate\nUNIQUE-SECOND-LINE-MARKER', content: [{ type: 'text', text: 'MCP-BODY-MARKER' }] },
  resultText: 'MCP-BODY-MARKER',
}

const rows: any[] = [
  Object.freeze({ id: 1, kind: 'user', text: 'fix the bug' }),
  Object.freeze({ id: 2, kind: 'assistant', text: 'Looking at the code.', streaming: false }),
  Object.freeze({ id: 3, kind: 'tool', text: '', tool: Object.freeze(readTool) }),
  Object.freeze({ id: 4, kind: 'tool', text: '', tool: Object.freeze(grepTool) }),
  Object.freeze({ id: 5, kind: 'tool', text: '', tool: Object.freeze(pwshTool) }),
  Object.freeze({ id: 6, kind: 'tool', text: '', tool: Object.freeze(mcpTool) }),
  Object.freeze({ id: 7, kind: 'assistant', text: 'All done.\nSECOND-LINE-ONLY', streaming: false }),
]

const listeners = new Set<() => void>()
const channel: any = {
  whaleIdle: false,
  version: 0, rows, status: 'idle', sessionTitle: 'probe', agentId: 'probe',
  model: 'deepseek-v4-flash', provider: 'deepseek', reasoningEffort: 'max', effortLevels: [],
  tokens: { input: 0, output: 0 }, cwd: '/tmp/demo', displayCwd: '/tmp/demo', gitBranch: 'main',
  working: false, spinnerMode: 'requesting', responseChars: 0, activeToolCount: 0, turnStart: Date.now(),
  pending: [], commandList: LOCAL_COMMANDS, notifications: [], mode: { plan: false, sandbox: undefined },
  activityFrames: 'moon8', agentPreset: undefined, subagents: [], lastUserText: 'fix the bug',
  scrollGutter: 'timeline', whale: true,
  subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) },
  emit() { channel.version++; for (const cb of listeners) cb() },
  submit: () => {}, cancel: () => {}, clear: () => {}, notify: () => {},
  listModels: () => Promise.resolve([]), listSessions: () => Promise.resolve([]),
  deleteSession: () => Promise.resolve(true), renameSessionTo: () => Promise.resolve(true),
  setResumeTarget: () => {}, loadOlder: () => {}, mcpStatus: () => [], pushLocal: () => {},
  commandCompletions: (input: string) => completeCommands(input),
}

const inst = await render(
  <AlternateScreen><Chat channel={channel} questionStore={new QuestionStore()} fullscreen /></AlternateScreen>,
  { stdout: stdout as any, stdin: stdin as any, stderr: stderr as any, exitOnCtrlC: false, patchConsole: false },
)

// 0. Tone families: Read/Grep/Pwsh/MCP must not share a colour or a wash.
{
  const dark = getTheme('dark')
  const names = [['Read', 'read'], ['Grep', 'search'], ['Pwsh', 'exec'], ['mcp__playwright__x', 'mcp']] as const
  for (const [raw, expected] of names) {
    check(`tone: ${raw} maps to ${expected}`, toolTone.toolToneFamily(raw) === expected, toolTone.toolToneFamily(raw))
  }
  const tokens = names.map(([raw]) => toolTone.toolToneColor(toolTone.toolToneFamily(raw)))
  check('tone: Read/Grep/Pwsh/MCP use distinct theme tokens', new Set(tokens).size === 4, tokens.join(','))
  const washes = names.map(([raw]) => toolTone.toolCardWash(dark, toolTone.toolToneFamily(raw), 'subtle'))
  check('tone: the four card washes are distinct', new Set(washes).size === 4, washes.join(' '))
  check('tone: the wash is a truecolor blend', washes.every(value => typeof value === 'string' && value.startsWith('rgb(')))
}

// 1. Final summary stays at the END of the turn (where it streamed) and is
// always expanded — earlier builds relocated it above the tool cards, which
// teleported it out of the viewport on long turns.
check('final summary renders', await settled(() => screen().includes('Final summary')))
const summaryRow = rowOf('Final summary')
const readRow = rowOf('Read')
check('final summary sits after the tool cards', summaryRow >= 0 && summaryRow > readRow, `summary=${summaryRow} read=${readRow}`)
check('final summary body keeps the first line', screen().includes('All done.'))
check('final summary renders its later body lines', screen().includes('SECOND-LINE-ONLY'))

// 2. One-line Read / Grep / Pwsh / MCP cards: header visible, body hidden.
check('Read card header renders', readRow >= 0)
check('Grep card header renders', screenLines().some(line => line.includes('TODO')))
check('Pwsh card header renders', screen().includes('npm test'))
check('MCP card header renders', screen().includes('browser_evaluate'))
check('Read body stays collapsed', !screen().includes('READ-BODY-MARKER'))
check('Grep body stays collapsed', !screen().includes('GREP-BODY-MARKER'))
check('Pwsh body stays collapsed', !screen().includes('PWSH-BODY-MARKER'))
check('MCP body stays collapsed', !screen().includes('MCP-BODY-MARKER'))
check('one-line MCP header flattens its embedded newline', (() => {
  const line = screenLines().find(candidate => candidate.includes('MCP browser_evaluate')) ?? ''
  return line.includes('UNIQUE-SECOND-LINE-MARKER') &&
    screenLines().filter(candidate => candidate.includes('UNIQUE-SECOND-LINE-MARKER')).length === 1
})(), screenLines().find(candidate => candidate.includes('MCP browser_evaluate')))
check('one-line Pwsh header flattens the command newline', (() => {
  const line = screenLines().find(candidate => candidate.includes('npm test')) ?? ''
  return line.includes('SECOND-CMD-LINE') &&
    screenLines().filter(candidate => candidate.includes('SECOND-CMD-LINE')).length === 1
})(), screenLines().find(candidate => candidate.includes('npm test')))
check('collapsed one-line cards expose the disclosure hint', (screen().match(/▸/g) ?? []).length >= 4,
  'arrows=' + String((screen().match(/▸/g) ?? []).length))

// 3. Ctrl+O expands the tool bodies; the summary body is expanded regardless.
stdin.write('\x0f')
await sleep(120)
check('Ctrl+O expands the Read card body', await settled(() => screen().includes('READ-BODY-MARKER')))
check('Ctrl+O expands the Pwsh card body', await settled(() => screen().includes('PWSH-BODY-MARKER')))
stdin.write('\x0f')
await sleep(120)
check('Ctrl+O again collapses the tool bodies', await settled(() => !screen().includes('READ-BODY-MARKER')))
check('final summary stays expanded across the toggle', screen().includes('SECOND-LINE-ONLY'))

// 4. A running tool holds the answer at the bottom; settling promotes it.
const runningTool: any = { ...pwshTool, callId: 'call-run', status: 'running', durationMs: undefined, resultView: undefined }
rows.push(
  Object.freeze({ id: 8, kind: 'user', text: 'second turn' }),
  Object.freeze({ id: 9, kind: 'tool', text: '', tool: runningTool }),
  Object.freeze({ id: 10, kind: 'assistant', text: 'PENDING-ANSWER-MARKER\nRUNNING-SECOND-LINE', streaming: false }),
)
channel.emit()
check('running tool keeps the answer un-lifted', await settled(() => screen().includes('PENDING-ANSWER-MARKER')))
check('no second final summary while a tool runs', (screen().match(/Final summary/g) ?? []).length === 1,
  'count=' + String((screen().match(/Final summary/g) ?? []).length))
runningTool.status = 'ok'
runningTool.durationMs = 1000
channel.emit()
check('settling the tool lifts the second answer', await settled(() => (screen().match(/Final summary/g) ?? []).length === 2),
  'count=' + String((screen().match(/Final summary/g) ?? []).length))
check('lifted second summary shows its later line', screen().includes('RUNNING-SECOND-LINE'))

// 5. While the agent is still running, the newest turn's answer stays at the
// bottom; going idle promotes it (a mid-turn step must not flicker up).
{
  channel.status = 'running'
  rows.push(
    Object.freeze({ id: 11, kind: 'user', text: 'third turn' }),
    Object.freeze({ id: 12, kind: 'tool', text: '', tool: Object.freeze({ ...readTool, callId: 'call-read-3' }) }),
    Object.freeze({ id: 13, kind: 'assistant', text: 'GATED-ANSWER-MARKER\nGATED-SECOND-LINE', streaming: false }),
  )
  channel.emit()
  check('agent running: newest answer stays un-lifted', await settled(() => screen().includes('GATED-ANSWER-MARKER')))
  check('agent running: no new final summary yet', (screen().match(/Final summary/g) ?? []).length === 2,
    'count=' + String((screen().match(/Final summary/g) ?? []).length))
  channel.status = 'idle'
  channel.emit()
  check('agent idle: newest answer is lifted', await settled(() => (screen().match(/Final summary/g) ?? []).length === 3),
    'count=' + String((screen().match(/Final summary/g) ?? []).length))
}

inst.unmount()
if (failed > 0) {
  console.error('FAILED: ' + failed + ' check(s).')
  process.exit(1)
}
console.log('OK: comet transcript checks passed.')
process.exit(0)
