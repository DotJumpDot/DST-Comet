// Verify a .jsonl.zstd session log passes the exact persistence admission
// gate (every event row: known catalog type OR envelope ignorable marker).
// Run from a directory whose node_modules has @deepseek-ai/dsh-session
// (e.g. vendor/dsh-tui), with log paths as arguments.
import fs from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'

const ZSTD_MAGIC = 4247762216

function scan(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad magic at ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const d = buffer.readUInt8(offset)
    offset += 1
    if ((d & 24) !== 0) throw new Error('reserved header bit')
    const csf = d >>> 6
    const ss = (d & 32) !== 0
    const ck = (d & 4) !== 0
    const df = d & 3
    const db = df === 3 ? 4 : df
    const cb = csf === 0 ? (ss ? 1 : 0) : 1 << csf
    const rem = (ss ? 0 : 1) + db + cb
    if (buffer.length - offset < rem) return { frames, tornStart: start }
    offset += rem
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const bh = buffer.readUIntLE(offset, 3)
      offset += 3
      const last = (bh & 1) !== 0
      const bt = (bh >>> 1) & 3
      const bs = bh >>> 3
      if (bt === 3) throw new Error('reserved block type')
      const pb = bt === 1 ? 1 : bs
      if (buffer.length - offset < pb) return { frames, tornStart: start }
      offset += pb
      if (last) break
    }
    if (ck) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

let failures = 0
for (const file of process.argv.slice(2)) {
  const buf = fs.readFileSync(file)
  const { frames, tornStart } = scan(buf)
  let rows = 0
  let refused = 0
  let released = 0
  let header = null
  for (const f of frames) {
    const text = zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const obj = JSON.parse(line)
      if (obj.type === 'session') { header = obj; continue }
      rows++
      if (obj.type === 'team/member/released') released++
      if (!KNOWN_SESSION_EVENT_TYPES.has(obj.type) && obj.ignorable !== true) {
        refused++
        console.log('  REFUSED ROW:', JSON.stringify(obj).slice(0, 160))
      }
    }
  }
  const name = file.split(/[\\/]/).pop()
  const verdict = refused === 0 ? 'ADMISSIBLE' : `WOULD-REFUSE ${refused} row(s)`
  if (refused !== 0) failures++
  console.log(`${name}: id=${header?.id} events=${rows} released=${released} ${verdict}${tornStart !== undefined ? ' (+torn tail)' : ''}`)
}
process.exit(failures === 0 ? 0 : 1)
