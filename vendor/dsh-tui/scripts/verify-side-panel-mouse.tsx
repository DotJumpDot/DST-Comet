/**
 * Side-panel mouse regression: the bar is the one place where a click
 * switches WHAT the whole right column shows, so it must be clickable and
 * the ⤢ fullscreen affordance must appear only for panels that actually have
 * a fullscreen form (capabilities.fullscreen).
 *
 * DST Comet navigator contract (was a fan of every panel's icon):
 *  a. only the active panel's icon + title sits between the two arrows;
 *  b. the arrows cycle the panel order and carry a badge tone in their
 *     direction when a hidden panel has an alert;
 *  c. the arrows wrap, and ⤢ appears by capability;
 *  d. ⤢ calls the host with the active panel id;
 *  e. clicking the chat column returns focus to chat.
 *
 * Run: node --import tsx/esm scripts/verify-side-panel-mouse.tsx
 */
export {}

process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'en'

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, ui, { SidePanelLayout }, { SidePanelColumn }, { useSidePanel }, prefs, { TooltipLayer }, termTest, { sidebarBrandRows }] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/components/sidePanel/SidePanelLayout.js'),
  import('../src/components/sidePanel/SidePanelColumn.js'),
  import('../src/components/sidePanel/useSidePanel.js'),
  import('../src/tuiDisplayPrefs.js'),
  import('../src/components/Tooltip.js'),
  import('./lib/term-test.mjs'),
  import('../src/components/sidePanel/sidebarBrand.js'),
])
const { render, AlternateScreen, Box, Text, useInput } = ui
const { applySidePanelOpen, applySidePanelPanels, applySidePanelRatio } = prefs
const { settled, viewportLines } = termTest

const COLS = 120
const ROWS = 20

let failed = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (extra ? '  (' + extra + ')' : ''))
  if (!ok) failed += 1
}

/** Host-side record of ⤢ clicks (mirrors Chat's openPanelFullscreen). */
let expanded: string[] = []

const channelStub: unknown = {
  version: 0, rows: [], status: 'idle', working: false, goal: undefined, todos: [], subagents: [],
  // jobs 摘要（length）/info 读数（notifications）/workspace 路径（displayCwd）
  backgroundJobs: [],
  notifications: [],
  displayCwd: '/tmp/demo',
  cwd: '/tmp/demo',
  // info 行读数经 status 助手派生（modeDisplayName 读 mode.label 等）——
  // 字段集照 verify-side-panel-registry 的桩（那里踩过同样的坑）。
  mode: { plan: false },
  sessionTitle: 'mouse',
  sessionId: 'abcd1234-5678-90ab-cdef-1234567890ab',
  agentId: 'mouse-agent',
  gitBranch: 'main',
  model: 'deepseek-chat-v4',
  reasoningEffort: 'high',
  tokens: { input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  listWorkspaceRegistry: () => Promise.resolve([]),
  listSessions: () => Promise.resolve([]),
  subscribe() { return () => {} },
  notify() {},
}

function Harness({ columns = COLS }: { readonly columns?: number } = {}): React.ReactNode {
  const sp = useSidePanel({ columns, fullscreen: true, editorOpen: false })
  // Mouse/keys only reach the tree while stdin has a readable listener the
  // ink App owns; MessageList-free fixtures must keep one alive.
  useInput(() => {}, { isActive: true })
  return (
    <SidePanelLayout
      geometry={sp.geometry}
      focus={sp.focus}
      onActivateChat={sp.focusChat}
      onActivatePanel={sp.focusPanel}
      onResize={sp.resize}
      side={
        <SidePanelColumn
          width={sp.panelColumns}
          controller={sp}
          channel={channelStub as never}
          onExpand={(id: string) => { expanded = [...expanded, id] }}
        />
      }
    >
      <Box flexDirection="column">
        <Text>{'chat-body'}</Text>
      </Box>
    </SidePanelLayout>
  )
}

class FakeStdout extends Writable {
  columns = COLS
  rows = ROWS
  isTTY = true
  term: import('@xterm/headless').Terminal
  constructor(term: import('@xterm/headless').Terminal, cols?: number, rows?: number) {
    super()
    this.term = term
    if (cols !== undefined) this.columns = cols
    if (rows !== undefined) this.rows = rows
  }
  _write(chunk: unknown, _e: Buffer.Encoding, cb: () => void) { this.term.write(String(chunk), cb) }
}
class FakeStderr extends Writable { isTTY = true; _write(_c: unknown, _e: BufferEncoding, cb: () => void) { cb() } }
class FakeStdin extends PassThrough {
  isTTY = true
  isRaw = false
  setRawMode(next: boolean) { this.isRaw = next; return this }
  setEncoding() { return this }
  ref() { return this }
  unref() { return this }
}

const term = new XTerm({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true })
const stdout = new FakeStdout(term)
const stdin = new FakeStdin()

const lines = (): string[] => viewportLines(term, ROWS)
const has = (s: string): boolean => lines().some(line => line.includes(s))
const findText = (s: string): { col: number; row: number } | null => {
  const view = lines()
  for (let row = 0; row < view.length; row++) {
    const col = view[row]!.indexOf(s)
    if (col >= 0) return { col, row }
  }
  return null
}
// SGR 1-indexed。press(0)/release(0) = 点击。
const press = (c: number, r: number) => stdin.write('\x1b[<0;' + (c + 1) + ';' + (r + 1) + 'M')
const release = (c: number, r: number) => stdin.write('\x1b[<0;' + (c + 1) + ';' + (r + 1) + 'm')
const click = (c: number, r: number) => { press(c, r); release(c, r) }

applySidePanelRatio(0.68)
applySidePanelPanels('todo,jobs,agents')
applySidePanelOpen(true)

const app = await render(
  <AlternateScreen>
    <>
      <Harness />
      <TooltipLayer />
    </>
  </AlternateScreen>,
  {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: new FakeStderr() as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  },
)

try {
  const barRow = sidebarBrandRows(ROWS)
  check('a boot: active title is centered on Todo', await settled(() => has('Todo'), { timeoutMs: 4000 }))
  const bootBar = lines()[barRow] ?? ''
  check('a boot: only the active panel icon renders', bootBar.includes('≡ Todo') && !bootBar.includes('◆') && !bootBar.includes('▸'), bootBar.trim())
  check('a boot: the bar carries both nav arrows', bootBar.includes('◀') && bootBar.includes('▶'), bootBar.trim())
  check('a boot: no ⤢ for a panel without a fullscreen form', !has('⤢'))

  // ── b. arrows cycle the navigator (Todo → Jobs → Agents) ───────────────
  const clickArrow = (glyph: '◀' | '▶'): boolean => {
    const cell = findText(glyph)
    if (cell === null) return false
    click(cell.col, cell.row)
    return true
  }
  check('b arrows: right arrow located', findText('▶') !== null, JSON.stringify(findText('▶')))
  check('b arrows: Todo → Jobs', clickArrow('▶') && await settled(() => has('Jobs'), { timeoutMs: 4000 }))
  check('b arrows: Jobs → Agents', clickArrow('▶') && await settled(() => has('Agents') && has('⤢'), { timeoutMs: 4000 }))
  check('c arrows: left arrow located', findText('◀') !== null)
  check('c arrows: previous wraps from Agents to Jobs', clickArrow('◀') && await settled(() => has('Jobs'), { timeoutMs: 4000 }))
  check('c arrows: next returns to Agents', clickArrow('▶') && await settled(() => has('Agents') && has('⤢'), { timeoutMs: 4000 }))

  // ── d. ⤢ hands the ACTIVE panel id to the host ─────────────────────────
  const expand = findText('⤢')
  check('d ⤢: button located', expand !== null, JSON.stringify(expand))
  if (expand !== null) {
    click(expand.col, expand.row)
    // 固定窗:onExpand 是宿主回调，屏幕本身没有可轮询的变化点
    await new Promise(resolve => setTimeout(resolve, 200))
    check('d ⤢: host received the active panel id', expanded.length === 1 && expanded[0] === 'agents', JSON.stringify(expanded))
  }

  // ── e. clicking the chat column returns the focus ──────────────────────
  check('e focus: panel focus first (clicking the column focuses it)', await settled(() => has('Esc chat'), { timeoutMs: 4000 }))
  const body = findText('chat-body')
  check('e focus: chat body located', body !== null, JSON.stringify(body))
  if (body !== null) click(body.col, body.row)
  check('e focus: hint swaps back to the unfocused copy', await settled(() => has('Ctrl+B focus panel'), { timeoutMs: 4000 }))
} finally {
  await app.unmount()
}

// ── f. eight panels and fullscreen control stay on one narrow bar ─────────
{
  const NARROW = 96
  const NROWS = 14
  const term2 = new XTerm({ cols: NARROW, rows: NROWS, scrollback: 0, allowProposedApi: true })
  const lines2 = (): string[] => viewportLines(term2, NROWS)
  // Jobs starts active so the fullscreen control is present beside seven icons.
  applySidePanelRatio(0.78)
  applySidePanelPanels('jobs,todo,info,trajectory,btw,agents,workspace,companion')
  const app2 = await render(
    <AlternateScreen>
      <Harness columns={NARROW} />
    </AlternateScreen>,
    {
      stdout: new FakeStdout(term2, NARROW, NROWS) as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: new FakeStderr() as unknown as NodeJS.WriteStream,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  )
  try {
    await settled(() => lines2().some(line => line.includes('Jobs')), { timeoutMs: 4000 })
    const barRow = sidebarBrandRows(NROWS)
    const bar = lines2()[barRow] ?? ''
    check('f narrow: navigator shows the active panel only', bar.includes('Jobs') && bar.includes('◀') && bar.includes('▶') && !/[≡ⓘ∿◆♥]/u.test(bar), bar.trim())
    check('f narrow: ⤢ stays on the same row', bar.includes('⤢'), bar.trim())
    check('f fold: the bar is exactly one row (its rule is the next row)', (lines2()[barRow + 1] ?? '').includes('─'), (lines2()[barRow + 1] ?? '').trim())
  } finally {
    await app2.unmount()
  }
}

console.log(failed === 0 ? 'ALL PASS' : failed + ' FAILED')
process.exit(failed === 0 ? 0 : 1)
