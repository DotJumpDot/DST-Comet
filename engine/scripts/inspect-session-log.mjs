// Read-only inspector for .jsonl.zstd session logs (port of the jsonl backend
// frame scanner). Usage: node inspect-session-log.mjs <log-file> [type-filter]
import fs from 'node:fs'
import { constants, zstdCompress, zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'

const zstdDecompressAsync = promisify(zstdDecompress)
const zstdCompressAsync = promisify(zstdCompress)
const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid frame magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

const [file, filter] = process.argv.slice(2)
const buffer = fs.readFileSync(file)
const { frames, tornStart } = scanZstdFrames(buffer)
console.log(`file bytes: ${buffer.length}, frames: ${frames.length}${tornStart !== undefined ? `, TORN final frame at ${tornStart}` : ''}`)
let lineCount = 0
const hits = []
for (let i = 0; i < frames.length; i++) {
  const text = (await zstdDecompressAsync(buffer.subarray(frames[i].start, frames[i].end))).toString('utf8')
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  lineCount += lines.length
  lines.forEach((line, j) => {
    let obj
    try { obj = JSON.parse(line) } catch { console.log(`frame ${i} line ${j}: NOT JSON: ${line.slice(0, 120)}`); return }
    if (filter === undefined || obj.type === filter) {
      if (filter !== undefined) hits.push({ frame: i, line, obj })
      else if (obj.type === 'team/member/released') hits.push({ frame: i, line, obj })
    }
  })
  if (i === 0) console.log(`frame 0 first line: ${lines[0].slice(0, 200)}`)
}
console.log(`total json lines: ${lineCount}`)
console.log(`matching lines: ${hits.length}`)
for (const h of hits) {
  console.log(`--- frame ${h.frame} seq=${h.obj.seq} type=${h.obj.type} keys=${Object.keys(h.obj).join(',')}`)
  console.log(h.line.slice(0, 400))
}
