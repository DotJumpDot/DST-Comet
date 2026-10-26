/**
 * The sidebar mascot: the whale girl / pixel whale from the boot splash,
 * sampled down to a 16×8 sprite (4 half-block rows) so it fits beside the
 * two-line DST·Comet wordmark. The full splash art is 30×30 / 40×25; the
 * sampler crops to the art's bounding box first, then keeps cell centers —
 * nearest-neighbour keeps the pixel edges crisp instead of averaging the
 * face into a blue smudge at this size.
 */
import React from 'react'
import { Box, Text } from '../../ui.js'
import { renderCellRows, WHALE_PALETTE } from '../Whale.js'
import { WHALE_GIRL_SPRITE } from '../whaleGirlSprite.js'
import { WHALE_FRAMES } from '../whaleFrames.js'

type Rgb = readonly [number, number, number]

/** Logo box width in cells (the header's text column starts one cell after). */
export const SIDEBAR_LOGO_COLS = 22
/** Sprite pixel rows; half-block rendering packs two into one text row. */
const LOGO_PIXEL_ROWS = 16
/** Short-terminal strip: 4 pixel rows = 2 text rows. */
const COMPACT_PIXEL_ROWS = 4

interface Box2D {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** Tight bounds of the defined cells in a sprite grid. */
function boundsOf<T>(cols: number, rows: number, get: (x: number, y: number) => T | undefined): Box2D {
  let x0 = cols
  let y0 = rows
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (get(x, y) === undefined) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return x1 < x0 ? { x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 } : { x0, y0, x1, y1 }
}

/**
 * Mode-downsample one sprite grid into the logo box: each target cell takes
 * the most frequent non-transparent colour of its source region (the same
 * 众数 downsample the 30×30 portrait itself was built with). Nearest-
 * neighbour dropped the eyes and ribbon at this size; mode keeps the face's
 * colour blocks and reads as the character instead of a blue smudge.
 */
function sampleSprite(
  cols: number,
  rows: number,
  targetPixelRows: number,
  get: (x: number, y: number) => Rgb | undefined,
): (x: number, y: number) => Rgb | undefined {
  const box = boundsOf(cols, rows, get)
  const spanX = box.x1 - box.x0 + 1
  const spanY = box.y1 - box.y0 + 1
  const regionX = (x: number): readonly [number, number] => {
    const start = box.x0 + Math.floor(x * spanX / SIDEBAR_LOGO_COLS)
    const end = box.x0 + Math.floor((x + 1) * spanX / SIDEBAR_LOGO_COLS)
    return [start, Math.max(start + 1, end)]
  }
  const regionY = (y: number): readonly [number, number] => {
    const start = box.y0 + Math.floor(y * spanY / targetPixelRows)
    const end = box.y0 + Math.floor((y + 1) * spanY / targetPixelRows)
    return [start, Math.max(start + 1, end)]
  }
  return (x, y) => {
    const [x0, x1] = regionX(x)
    const [y0, y1] = regionY(y)
    const counts = new Map<string, { rgb: Rgb; count: number }>()
    let transparent = 0
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const rgb = get(sx, sy)
        if (rgb === undefined) {
          transparent++
          continue
        }
        const key = `${rgb[0]},${rgb[1]},${rgb[2]}`
        const found = counts.get(key)
        if (found === undefined) counts.set(key, { rgb, count: 1 })
        else found.count++
      }
    }
    let best: { rgb: Rgb; count: number } | undefined
    for (const candidate of counts.values()) {
      if (best === undefined || candidate.count > best.count) best = candidate
    }
    return best === undefined || best.count <= transparent ? undefined : best.rgb
  }
}

function whaleGirlGrid(targetPixelRows: number): (x: number, y: number) => Rgb | undefined {
  return sampleSprite(30, 30, targetPixelRows, (x, y) => WHALE_GIRL_SPRITE[y]?.[x] ?? undefined)
}

function whaleGrid(targetPixelRows: number): (x: number, y: number) => Rgb | undefined {
  const frame = WHALE_FRAMES[0]?.rows ?? []
  const width = frame.reduce((max, row) => Math.max(max, row.length), 0)
  return sampleSprite(width, frame.length, targetPixelRows, (x, y) => {
    const letter = frame[y]?.[x]
    return letter === undefined || letter === '.' ? undefined : WHALE_PALETTE[letter]
  })
}

const WHALE_GIRL_GRID = whaleGirlGrid(LOGO_PIXEL_ROWS)
const WHALE_GIRL_COMPACT_GRID = whaleGirlGrid(COMPACT_PIXEL_ROWS)
const WHALE_GRID = whaleGrid(LOGO_PIXEL_ROWS)
const WHALE_COMPACT_GRID = whaleGrid(COMPACT_PIXEL_ROWS)

const WHALE_GIRL_ROWS: readonly string[] = renderCellRows(SIDEBAR_LOGO_COLS, LOGO_PIXEL_ROWS, WHALE_GIRL_GRID)
const WHALE_GIRL_COMPACT_ROWS: readonly string[] = renderCellRows(SIDEBAR_LOGO_COLS, COMPACT_PIXEL_ROWS, WHALE_GIRL_COMPACT_GRID)
const WHALE_ROWS: readonly string[] = renderCellRows(SIDEBAR_LOGO_COLS, LOGO_PIXEL_ROWS, WHALE_GRID)
const WHALE_COMPACT_ROWS: readonly string[] = renderCellRows(SIDEBAR_LOGO_COLS, COMPACT_PIXEL_ROWS, WHALE_COMPACT_GRID)

/** One mascot as Ink rows; the caller owns the click/hover wrapper. */
export function SidebarMascot({ variant, compact = false }: { variant: 'whaleGirl' | 'whale'; compact?: boolean }): React.ReactNode {
  const rows = compact
    ? (variant === 'whale' ? WHALE_COMPACT_ROWS : WHALE_GIRL_COMPACT_ROWS)
    : (variant === 'whale' ? WHALE_ROWS : WHALE_GIRL_ROWS)
  return (
    <Box flexDirection="column" width={SIDEBAR_LOGO_COLS} flexShrink={0} overflow="hidden">
      {rows.map((row, index) => (
        <Text key={index} wrap="truncate-end">{row}</Text>
      ))}
    </Box>
  )
}
