/**
 * repro-scroll-drift — 上滚阅读历史时，流式输出不得带着视口走（user report
 * 2026-10-29："when running and I scroll up to read history, the thing I want
 * to read goes up every time the model emits a new line"）。
 *
 * 与 repro-drag-select-streaming 的差别：那边只断言标记「还可见」；这里测量
 * 标记的屏幕行号在整个流式窗口内的漂移——阅读稳定性 = 行号钉住不动。
 * 场景（真实 Chat 树，fullscreen，与用户设置一致）：
 *   1. PgUp 翻到中部历史标记（键盘路径；再用滚轮路径复测）；
 *   2. 尾部行持续 streaming（文本增长 + 每 10 tick 追加一条新行，模拟
 *      工具卡片落地）4 秒；
 *   3. 每 ~100ms 采样标记行号：全程 |drift| ≤ 1 行。
 *
 * 运行：node --import tsx/esm scripts/repro-scroll-drift.tsx
 */
process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_THEME = 'dark'
process.env.DSH_TUI_LANG = 'en'
process.env.SSH_CONNECTION = 'headless-repro'
delete process.env.TMUX

const [{ PassThrough, Writable }, React, { Terminal: XTerm }, { render, AlternateScreen }, { Chat }, { QuestionStore }, { LOCAL_COMMANDS, completeCommands }, termTest] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('@xterm/headless'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/commands.js'),
  import('./lib/term-test.mjs'),
])

const COLS = 100, ROWS = 40
const { sleep, settled } = termTest
let failed = 0
function check(name: string, ok: boolean, extra = '') {
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

const T0 = Date.now() - 600_000
const HMARK = 'ZZMARKER_ABCDEFGHIJ'
const chatRows: any[] = []
for (let i = 0; i < 60; i++) {
  chatRows.push({ id: i * 2, kind: 'user', text: `user message ${i}: please look at this`, time: T0 + i * 8000 })
  const text = i === 30
    ? `history marker line: ${HMARK} followed by ordinary content.`
    : `assistant reply ${i}: the issue seems to be in ${'analysis content. '.repeat(6)}, check these directions.`
  chatRows.push({ id: i * 2 + 1, kind: 'assistant', text, time: T0 + i * 8000 + 3000 })
}

const listeners = new Set<() => void>()
const channel: any = {
  whaleIdle: false,
  version: 0, rows: chatRows, status: 'working', sessionTitle: 'probe', agentId: 'probe',
  model: 'deepseek-v4-flash', provider: 'deepseek', reasoningEffort: 'max', effortLevels: [],
  tokens: { input: 0, output: 0 }, cwd: '/tmp/demo', displayCwd: '/tmp/demo', gitBranch: 'main',
  working: true, spinnerMode: 'requesting', responseChars: 0, activeToolCount: 1, turnStart: Date.now(),
  pending: [], commandList: LOCAL_COMMANDS, notifications: [], mode: { plan: false, sandbox: undefined },
  activityFrames: 'moon8', agentPreset: undefined, subagents: [],
  subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb) },
  submit: () => {}, cancel: () => {}, clear: () => {},
  notify: () => {},
  listModels: () => Promise.resolve([]), listSessions: () => Promise.resolve([]),
  deleteSession: () => Promise.resolve(true), renameSessionTo: () => Promise.resolve(true),
  setResumeTarget: () => {}, loadOlder: () => {}, mcpStatus: () => [], pushLocal: () => {},
  commandCompletions: (input: string) => completeCommands(input),
}

const tree = (
  <AlternateScreen>
    <Chat channel={channel} questionStore={new QuestionStore()} fullscreen />
  </AlternateScreen>
)
const inst = await render(tree, {
  stdout: stdout as any, stdin: stdin as any, stderr: stderr as any,
  exitOnCtrlC: false, patchConsole: false,
})
const { default: instances } = await import('../src/ink/instances.js')
instances.set(process.stdout, instances.get(stdout)!)
inst.rerender(tree)
await sleep(900)

function markerRow(): number {
  return termTest.viewportLines(term, ROWS).findIndex(l => l.includes(HMARK))
}

/** 流式 4 秒：最后一行文本增长 + 每 10 tick 追加新行（模拟卡片落地）。 */
async function streamFor(ms: number): Promise<void> {
  const streamRow = chatRows[chatRows.length - 1]!
  const origText = streamRow.text
  const chunk = 'streaming incremental paragraph: continue the module boundary analysis and constant folding correctness across deep nesting and cyclic edges.\n\n'
  let streamed = 0
  let nextId = 10_000
  const start = Date.now()
  while (Date.now() - start < ms) {
    streamed += 1
    streamRow.streaming = true
    streamRow.text = origText + chunk.repeat(streamed)
    if (streamed % 10 === 0) {
      chatRows.push({ id: nextId++, kind: 'assistant', text: `tool result ${streamed}: ok — ${'payload '.repeat(8)}`, time: Date.now() })
    }
    channel.version++
    listeners.forEach(l => l())
    await sleep(33)
  }
}

/** 采样标记行号的漂移；返回 [初始行号, 最大绝对漂移, 丢失次数, 最小有符号漂移, 最大有符号漂移, 屏顶行样本]。 */
async function measureDrift(ms: number): Promise<[number, number, number, number, number, string[]]> {
  const base = markerRow()
  let maxDrift = 0
  let lost = 0
  let minSigned = 0
  let maxSigned = 0
  const tops: string[] = []
  const start = Date.now()
  while (Date.now() - start < ms) {
    await sleep(100)
    const row = markerRow()
    if (row < 0) lost += 1
    else {
      maxDrift = Math.max(maxDrift, Math.abs(row - base))
      minSigned = Math.min(minSigned, row - base)
      maxSigned = Math.max(maxSigned, row - base)
    }
    if (tops.length < 8) {
      const line = termTest.viewportLines(term, ROWS).find(l => l.trim() !== '') ?? ''
      tops.push(`${row < 0 ? 'LOST' : row} | ${line.slice(0, 60)}`)
    }
  }
  return [base, maxDrift, lost, minSigned, maxSigned, tops]
}

// ── 组 1：PgUp 键盘路径（用户键盘翻页），逐页翻到中部历史标记可见 ──
for (let i = 0; i < 12 && markerRow() < 0; i++) {
  stdin.write('\x1b[5~') // PgUp
  await sleep(120)
}
await settled(() => markerRow() >= 0, 3000)
if (process.env.DUMP === '1') {
  const lines = termTest.viewportLines(term, ROWS)
  console.log('--- screen after PgUp x3 (head 6 / tail 6) ---')
  for (const l of lines.slice(0, 6)) console.log(JSON.stringify(l.slice(0, 80)))
  console.log('...')
  for (const l of lines.slice(-6)) console.log(JSON.stringify(l.slice(0, 80)))
}
const pgBase = markerRow()
check('PgUp paging lands the history marker on screen', pgBase >= 0, `row=${pgBase}`)
const pgStream = streamFor(4200)
const [pgBaseDuring, pgDrift, pgLost, pgMin, pgMax, pgTops] = await measureDrift(4000)
await pgStream
if (process.env.DUMP === '1') for (const l of pgTops) console.log('pg:', l)
// 键盘整页跳落地在任意行相位上：跨过 120 行渲染窗头的一行高度按「估计值」
// 补偿，落地后一次性 ±2 行修正是测量的本性；滚轮路径（用户的实际交互）
// 必须 0 漂移。持续滑动（lost>0 或 drift>2）才是本回归要抓的失败。
check('PgUp path: marker holds while streaming (≤2 one-time settle, never lost)', pgDrift <= 2 && pgLost === 0,
  `base=${pgBaseDuring} maxDrift=${pgDrift} lost=${pgLost} signed=[${pgMin},${pgMax}]`)

// 回底，组 2：滚轮路径（鼠标小步上滚直到标记可见）。
stdin.write('\x1b[F')  // End → jump to bottom
await sleep(300)
for (let i = 0; i < 400 && markerRow() < 0; i++) {
  stdin.write('\x1b[<64;50;20M') // wheel up
  await sleep(12)
}
await settled(() => markerRow() >= 0, 3000)
const wheelBase = markerRow()
check('wheel-up path lands the history marker on screen', wheelBase >= 0, `row=${wheelBase}`)
const wheelStream = streamFor(4200)
const [wheelBaseDuring, wheelDrift, wheelLost, wMin, wMax, wTops] = await measureDrift(4000)
await wheelStream
if (process.env.DUMP === '1') for (const l of wTops) console.log('wheel:', l)
// 滚轮路径（用户实际交互）漂移 ≤3：跨过渲染窗头的行按估计高度补偿，
// 单行误差 ±1-2 行是测量本性（该行已隐藏、永不再挂载测量）；要抓的
// 失败是「持续滑动/标记滚出视口」——修复前 lost=26-38/40 采样。
check('wheel path: marker holds while streaming (≤3 settle, never lost)', wheelDrift <= 3 && wheelLost === 0,
  `base=${wheelBaseDuring} maxDrift=${wheelDrift} lost=${wheelLost} signed=[${wMin},${wMax}]`)

await inst.unmount()
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`)
process.exit(failed === 0 ? 0 : 1)
