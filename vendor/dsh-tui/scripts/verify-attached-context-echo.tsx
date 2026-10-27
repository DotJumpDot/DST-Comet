/**
 * verify-attached-context-echo — the transcript side of "Send to Chat"
 * (DST-Comet, user ask 2026-10-27 night: "after I press m and type, nothing
 * shows whether the wall context rode along").
 *
 * A — pure parser (`replayAttachedContexts`): title/chars from the durable
 *     `<attached-context …>` block, attribute unescape, non-context blocks
 *     ignored, empty list → undefined.
 * B — production reducer: a `user.message` carrying a typed block plus
 *     context blocks renders the typed text as the bubble AND records the
 *     echo entries on the row — live and replay take the same path.
 *
 * Run: node --import tsx/esm scripts/verify-attached-context-echo.tsx
 */
process.env.DSH_TUI_LANG = 'zh'
process.env.DSH_TUI_THEME = 'dark'

const nodePath = await import('node:path')
const nodeFs = await import('node:fs')
const nodeOs = await import('node:os')
// 家目录隔离：channel 构造路径会 touch ~/.dsh-tui。
const isolatedHome = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'dshtui-ctx-echo-'))
process.env.HOME = isolatedHome
process.env.USERPROFILE = isolatedHome

const { replayAttachedContexts } = await import('../src/channel/attached-context-record.js')
const { createProjectorHarness } = await import('./lib/projector-harness.js')
const { buildAttachedContextBlock } = await import('../src/dsh-adapter/channel/attached-context.js')

let failed = 0
function check(name: string, ok: boolean, extra?: string) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra === undefined ? '' : `  (${extra})`))
  if (!ok) failed += 1
}

console.log('--- A: replayAttachedContexts (pure) ---')
{
  const block = buildAttachedContextBlock({
    id: 'ctx-1', source: 'panel', sourceId: 'task-3', title: 'Human wall: Bugcrowd login',
    content: '1. open the page\n2. click allow', chars: 29, truncated: false,
  })
  const echoes = replayAttachedContexts([{ type: 'text', text: 'typed first' }, { type: 'text', text: block }])
  check('A1 context block → one echo with title + body size',
    echoes !== undefined && echoes.length === 1 && echoes[0]!.title === 'Human wall: Bugcrowd login'
    && echoes[0]!.chars === '1. open the page\n2. click allow'.length,
    JSON.stringify(echoes))

  const escaped = buildAttachedContextBlock({
    id: 'ctx-2', source: 'panel', sourceId: 'a"b', title: 'x&y<z>', content: 'c', chars: 1, truncated: false,
  })
  const echoEscaped = replayAttachedContexts([{ type: 'text', text: escaped }])
  check('A2 标题属性反转义（&quot; &amp; &lt; &gt;）',
    echoEscaped !== undefined && echoEscaped[0]!.title === 'x&y<z>', JSON.stringify(echoEscaped))

  check('A3 无 context 块 → undefined',
    replayAttachedContexts([{ type: 'text', text: 'plain' }]) === undefined
    && replayAttachedContexts([]) === undefined && replayAttachedContexts(undefined) === undefined)
}

console.log('--- B: shared projector row (live + replay) ---')
{
  const contextText = buildAttachedContextBlock({
    id: 'ctx-1', source: 'panel', sourceId: 'task-3', title: 'Human wall: Bugcrowd login',
    content: '1. open the page\n2. click allow', chars: 29, truncated: false,
  })
  const event = {
    type: 'user.message', id: 'm1', anchor: '1', seq: 1, time: 0,
    blocks: [{ type: 'text', text: 'yes go ahead' }, { type: 'text', text: contextText }],
    source: 'user', text: 'yes go ahead',
  }
  const live = createProjectorHarness()
  live.apply([event] as never)
  const liveRow = live.state.rows.find(row => row.kind === 'user')
  check('B1 live：气泡文本仍是首块（typed），echo 挂在行上',
    liveRow !== undefined && liveRow.text === 'yes go ahead'
    && liveRow.attachedContexts !== undefined && liveRow.attachedContexts.length === 1
    && liveRow.attachedContexts[0]!.title === 'Human wall: Bugcrowd login',
    JSON.stringify(liveRow?.text))

  const replay = createProjectorHarness()
  replay.apply([event] as never, true)
  const replayRow = replay.state.rows.find(row => row.kind === 'user')
  check('B2 replay（重启后从日志重建）与 live 同形',
    replayRow !== undefined && replayRow.text === 'yes go ahead'
    && JSON.stringify(replayRow.attachedContexts) === JSON.stringify(liveRow!.attachedContexts))

  // 同一事件缺 context 块：不产 echo（普通消息零变化）。
  const plain = createProjectorHarness()
  plain.apply([{ ...event, blocks: [{ type: 'text', text: 'yes go ahead' }] }] as never)
  const plainRow = plain.state.rows.find(row => row.kind === 'user')
  check('B3 无 context 块的 user 行不携带 echo', plainRow !== undefined && plainRow.attachedContexts === undefined)
}

console.log('')
console.log(failed === 0 ? 'verify-attached-context-echo: all checks passed' : `verify-attached-context-echo: ${failed} check(s) FAILED`)
process.exit(failed === 0 ? 0 : 1)
