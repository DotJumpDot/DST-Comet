import React from 'react'
import { Box, Text } from '../../ui.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { useTooltip } from '../Tooltip.js'

export type PanelBadgeLevel = 'info' | 'warning' | 'error'

export interface PanelBarTab {
  readonly id: string
  readonly title: string
  readonly icon?: string
  readonly badge?: { readonly level: PanelBadgeLevel; readonly unread: number } | null
}

export interface PanelBarProps {
  readonly tabs: readonly PanelBarTab[]
  readonly activeId: string | undefined
  readonly width: number
  readonly focused: boolean
  readonly canExpand?: boolean
  readonly onExpand?: () => void
  readonly onSelect?: (id: string) => void
}

function badgeColor(level: PanelBadgeLevel): 'warning' | 'error' | 'accent' {
  if (level === 'warning') return 'warning'
  if (level === 'error') return 'error'
  return 'accent'
}

function tabIcon(tab: PanelBarTab): string {
  return tab.icon ?? Array.from(tab.title)[0] ?? '?'
}

function truncateCells(text: string, maxCells: number): string {
  if (stringWidth(text) <= maxCells) return text
  let out = ''
  let cells = 0
  for (const char of text) {
    const width = stringWidth(char)
    if (cells + width > Math.max(1, maxCells - 1)) break
    out += char
    cells += width
  }
  return out + '…'
}

/**
 * DST Comet: the panel bar is a navigator, not a tab strip. Only the active
 * panel's icon + name sit between the two arrows — the old fan of every
 * enabled panel's icon read as a wall of identical blue glyphs and said
 * nothing about where you were.
 */
function ActiveTabLabel({
  tab,
  left,
  width,
  focused,
  hovered,
  onHover,
}: {
  readonly tab: PanelBarTab
  readonly left: number
  readonly width: number
  readonly focused: boolean
  readonly hovered: boolean
  readonly onHover: (hovered: boolean) => void
}): React.ReactNode {
  const label = `${tabIcon(tab)} ${tab.title}`
  const clipped = stringWidth(label) > width
  const tooltip = useTooltip(label)
  const unread = tab.badge?.unread ?? 0
  const tone = tab.badge !== null && tab.badge !== undefined
    ? badgeColor(tab.badge.level)
    : focused || hovered
      ? 'accent'
      : undefined
  return (
    <Box
      position="absolute"
      left={left}
      top={0}
      width={width}
      height={1}
      justifyContent="center"
      overflow="hidden"
      {...(clipped ? tooltip : {})}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <Text bold={focused || hovered || tab.badge != null} color={tone} wrap="truncate-end">
        <Text color={tone}>{tabIcon(tab)}</Text>
        <Text color={tone}>{` ${truncateCells(tab.title, Math.max(1, width - stringWidth(tabIcon(tab)) - 2))}`}</Text>
        {unread > 0 && <Text color={badgeColor(tab.badge!.level)}>{` ${unread}`}</Text>}
      </Text>
    </Box>
  )
}

function Arrow({
  glyph,
  left,
  focused,
  tone,
  onClick,
}: {
  readonly glyph: string
  readonly left: number
  readonly focused: boolean
  /** A badge on the panels in this direction: keep the alert visible even
   *  though the inactive tabs' icons are gone. */
  readonly tone?: 'warning' | 'error'
  readonly onClick: () => void
}): React.ReactNode {
  const [hovered, setHovered] = React.useState(false)
  return (
    <Box
      position="absolute"
      left={left}
      top={0}
      width={1}
      height={1}
      justifyContent="center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={event => {
        event.stopImmediatePropagation()
        onClick()
      }}
    >
      <Text bold={hovered || tone !== undefined} color={tone ?? (hovered || focused ? 'accent' : 'inactive')}>{glyph}</Text>
    </Box>
  )
}

export function PanelBar({ tabs, activeId, width, focused, canExpand, onExpand, onSelect }: PanelBarProps): React.ReactNode {
  const [expandHovered, setExpandHovered] = React.useState(false)
  const [labelHovered, setLabelHovered] = React.useState(false)
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeId))
  const active = tabs[activeIndex]
  const hasArrows = tabs.length > 1
  const arrowWidth = hasArrows ? 1 : 0
  const expandWidth = canExpand === true ? 2 : 0
  // `width` is the whole panel column; paddingX={1} eats one cell each side.
  // One trailing cell stays empty: ▶/⤢ are ambiguous-width glyphs in some
  // terminals and must never be the last painted cell (it wraps the row).
  const contentWidth = Math.max(0, width - 2)
  const middleStart = arrowWidth
  const middleWidth = Math.max(0, contentWidth - arrowWidth * 2 - expandWidth - 1)
  const badgeTone = (slice: readonly PanelBarTab[]): 'warning' | 'error' | undefined => {
    let tone: 'warning' | 'error' | undefined
    for (const tab of slice) {
      if (tab.badge == null) continue
      if (tab.badge.level === 'error') return 'error'
      if (tab.badge.level === 'warning') tone = 'warning'
    }
    return tone
  }
  const leftBadge = badgeTone(tabs.slice(0, activeIndex))
  const rightBadge = badgeTone(tabs.slice(activeIndex + 1))
  const changePanel = (delta: number): void => {
    if (active === undefined || tabs.length <= 1) return
    onSelect?.(tabs[(activeIndex + delta + tabs.length) % tabs.length]!.id)
  }
  return (
    <Box height={1} flexShrink={0} paddingX={1} overflow="hidden">
      <Box width={contentWidth} height={1} position="relative" overflow="hidden" flexShrink={0}>
        {hasArrows && <Arrow glyph="◀" left={0} focused={focused} tone={leftBadge} onClick={() => changePanel(-1)} />}
        {active !== undefined && middleWidth > 0 && (
          <ActiveTabLabel
            tab={active}
            left={middleStart}
            width={middleWidth}
            focused={focused}
            hovered={labelHovered}
            onHover={setLabelHovered}
          />
        )}
        {hasArrows && <Arrow glyph="▶" left={middleStart + middleWidth} focused={focused} tone={rightBadge} onClick={() => changePanel(1)} />}
        {canExpand === true && (
          <Box
            position="absolute"
            left={contentWidth - 1}
            top={0}
            width={1}
            height={1}
            onMouseEnter={() => { setExpandHovered(true) }}
            onMouseLeave={() => { setExpandHovered(false) }}
            onClick={event => { event.stopImmediatePropagation(); onExpand?.() }}
          >
            <Text bold={expandHovered} color={expandHovered || focused ? 'accent' : 'inactive'}>⤢</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
