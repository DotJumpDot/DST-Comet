/**
 * Repair session logs stranded by fork-only `team/member/released` events.
 *
 * DST-Comet's agent-team fork appends `team/member/released` (release_teammate)
 * as a plain session event. That type is NOT in the upstream released catalog
 * (`KNOWN_SESSION_EVENT_TYPES`), so the persistence read path refuses the WHOLE
 * log: `... unknown to this harness and not marked ignorable; refusing to
 * interpret the log`. Upstream's compatibility contract for out-of-repo events
 * is the envelope marker `ignorable: true` — readers that do not know the type
 * retain and skip the record instead of refusing.
 *
 * This script rewrites stored `team/member/released` lines to carry
 * `"ignorable":true` — the minimal change upstream's own V3->V4 edge performs
 * on unknown events. The event type, seq, time and data stay byte-identical,
 * so a projection that knows the type (our fork) still applies the release and
 * a stock harness merely retains+skips it.
 *
 * Surgery is frame-level: the .jsonl.zstd artifact is a concatenation of
 * independent checksummed zstd frames; frames without target lines are copied
 * byte-verbatim, only touched frames are re-encoded. A `.pre-repair.bak`
 * backup is written next to the log and the output is verified by full
 * round-trip before the rename.
 *
 * Usage:
 *   node repair-released-events.mjs [--dry-run] <path>...
 *     <path> — a session.v4.jsonl.zstd file, a session directory, or a
 *              sessions root (scanned recursively)
 */
import fs, { renameSync } from 'node:fs'
import { constants, zstdCompress, zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { basename, join } from 'node:path'

const zstdDecompressAsync = promisify(zstdDecompress)
const zstdCompressAsync = promisify(zstdCompress)
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const ZSTD_MAGIC = 4247762216
const TARGET_TYPE = 'team/member/released'

/** Port of the jsonl backend's frame scanner (complete frames only). */
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

function collectLogs(path) {
  const st = fs.statSync(path)
  if (st.isFile()) return [path]
  const found = []
  const queue = [path]
  while (queue.length > 0) {
    const dir = queue.shift()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(child)
      else if (entry.name === 'session.v4.jsonl.zstd') found.push(child)
    }
  }
  return found
}

/** Rewrite one frame's plaintext lines; returns {text, changed} or null when untouched. */
function rewriteFrame(text) {
  const lines = text.split('\n')
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes(`"type":"${TARGET_TYPE}"`)) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj === null || typeof obj !== 'object' || obj.type !== TARGET_TYPE || obj.ignorable === true) continue
    // String-level splice keeps every other byte of the line identical.
    lines[i] = line.replace(
      `{"type":"${TARGET_TYPE}",`,
      `{"type":"${TARGET_TYPE}","ignorable":true,`,
    )
    const check = JSON.parse(lines[i])
    if (check.ignorable !== true || check.seq !== obj.seq || check.time !== obj.time) {
      throw new Error(`rewritten line failed verification: ${line.slice(0, 200)}`)
    }
    changed = true
  }
  return changed ? { text: lines.join('\n'), changed } : { text, changed: false }
}

async function repairLog(file, dryRun) {
  const buffer = fs.readFileSync(file)
  const { frames, tornStart } = scanZstdFrames(buffer)
  let touched = 0
  const pieces = []
  for (const frame of frames) {
    const slice = buffer.subarray(frame.start, frame.end)
    const text = (await zstdDecompressAsync(slice)).toString('utf8')
    const result = rewriteFrame(text)
    if (!result.changed) {
      pieces.push(slice)
      continue
    }
    touched++
    if (dryRun) { pieces.push(slice); continue }
    pieces.push(await zstdCompressAsync(Buffer.from(result.text, 'utf8'), CHECKSUM_OPTIONS))
  }
  const tailStart = tornStart !== undefined ? tornStart : frames.length > 0 ? frames[frames.length - 1].end : buffer.length
  console.log(`${file}\n  frames=${frames.length}${tornStart !== undefined ? ' (+torn tail preserved)' : ''} released-events=${touched}${dryRun ? ' [dry-run]' : ''}`)
  if (touched === 0 || dryRun) return { touched, repaired: false }
  const output = Buffer.concat([...pieces, buffer.subarray(tailStart)])

  // Verify the rewritten artifact end-to-end before replacing anything.
  const verify = scanZstdFrames(output)
  if (verify.tornStart !== undefined && tornStart === undefined) throw new Error('verification failed: repair introduced a torn frame')
  if (verify.frames.length !== frames.length) throw new Error('verification failed: frame count changed')
  for (let i = 0; i < frames.length; i++) {
    const before = (await zstdDecompressAsync(buffer.subarray(frames[i].start, frames[i].end))).toString('utf8')
    const after = (await zstdDecompressAsync(output.subarray(verify.frames[i].start, verify.frames[i].end))).toString('utf8')
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    if (beforeLines.length !== afterLines.length) throw new Error(`verification failed: frame ${i} line count changed`)
    for (let j = 0; j < beforeLines.length; j++) {
      const b = beforeLines[j]
      const a = afterLines[j]
      if (b === a) continue
      const bObj = JSON.parse(b)
      const aObj = JSON.parse(a)
      if (bObj.type !== TARGET_TYPE || aObj.type !== TARGET_TYPE || aObj.ignorable !== true
        || aObj.seq !== bObj.seq || aObj.time !== bObj.time
        || JSON.stringify(aObj.data) !== JSON.stringify(bObj.data)) {
        throw new Error(`verification failed: frame ${i} line ${j} changed beyond the ignorable marker`)
      }
    }
  }
  const backup = `${file}.pre-repair.bak`
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
  const temp = `${file}.repaired.tmp`
  fs.writeFileSync(temp, output)
  renameSync(temp, file)
  console.log(`  repaired ${touched} event(s); backup: ${basename(backup)}`)
  return { touched, repaired: true }
}

const args = process.argv.slice(2)
const dryRun = args[0] === '--dry-run'
const paths = dryRun ? args.slice(1) : args
if (paths.length === 0) {
  console.error('usage: node repair-released-events.mjs [--dry-run] <session-log | session-dir | sessions-root>...')
  process.exit(2)
}
let total = 0
let repairedFiles = 0
for (const p of paths) {
  for (const log of collectLogs(p)) {
    try {
      const { touched, repaired } = await repairLog(log, dryRun)
      total += touched
      if (repaired) repairedFiles++
    } catch (error) {
      console.error(`  FAILED: ${log}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }
}
console.log(`done: ${total} released event(s) ${dryRun ? 'found' : 'marked ignorable'} across ${repairedFiles} log(s)`)
