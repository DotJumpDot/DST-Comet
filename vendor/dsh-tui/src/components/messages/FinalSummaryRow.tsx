/**
 * DST Comet final-summary row: the settled assistant answer of a turn that
 * used tools is lifted to the top of that turn's workflow and folded into a
 * single success line (`✓ Final summary · <first line>`). Clicking — or
 * Ctrl+O — expands the full Markdown body; the transcript itself keeps the
 * original session-event order, this is a display lift (see MessageList's
 * `promoteFinalSummaries`).
 */
import React from 'react'
import { Box, Text, useTerminalSize } from '../../ui.js'
import { Markdown } from '../Markdown.js'
import { t } from '../../i18n.js'
import { truncateToWidth } from '../../ink/truncateToWidth.js'

/** First meaningful prose line of a Markdown answer, stripped of the
 *  structural marks that would read as noise in a one-line preview. */
function previewLine(text: string): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('```') || /^[-*_]{3,}$/u.test(line)) continue
    return line
      .replace(/^[#>*+\-]+\s*/u, '')
      .replace(/[*_`]/gu, '')
  }
  return text.trim()
}

export interface FinalSummaryRowProps {
  readonly text: string
  /** Global (Ctrl+O) or per-row expansion. */
  readonly expanded: boolean
  /** Toggle expansion (row click / header click). */
  readonly onToggle: () => void
  readonly isSelected?: boolean
}

export function FinalSummaryRow({ text, expanded, onToggle, isSelected = false }: FinalSummaryRowProps): React.ReactNode {
  const { columns } = useTerminalSize()
  const [hovered, setHovered] = React.useState(false)
  const lines = text.trim() === '' ? 0 : text.trim().split('\n').length
  const preview = previewLine(text)
  const previewWidth = Math.max(8, columns - 28)
  const clipped = truncateToWidth(preview, previewWidth)
  const previewTail = clipped.length < preview.length ? '…' : ''
  if (expanded) {
    return (
      <Box flexDirection="column" width="100%">
        <Box
          flexDirection="row"
          onClick={event => {
            event.stopImmediatePropagation()
            onToggle()
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Box minWidth={2} flexShrink={0}>
            <Text color="success">✓</Text>
          </Box>
          <Text bold color="success">{t('final-summary-title')}</Text>
          <Text dimColor>{` · ${t('final-summary-lines', { n: lines })}`}</Text>
          <Box flexGrow={1} />
          <Text color={hovered ? 'accent' : 'subtle'}>▴</Text>
        </Box>
        <Box paddingLeft={2} flexDirection="column">
          <Markdown>{text}</Markdown>
        </Box>
      </Box>
    )
  }
  return (
    <Box
      flexDirection="row"
      width="100%"
      onClick={event => {
        event.stopImmediatePropagation()
        onToggle()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Box minWidth={2} flexShrink={0}>
        <Text color="success">✓</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">
          <Text bold color={hovered && !isSelected ? 'accent' : 'success'}>{t('final-summary-title')}</Text>
          <Text dimColor>{` · ${clipped}${previewTail}`}</Text>
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text color={hovered ? 'accent' : 'subtle'}>
          {lines > 1 ? `${lines} ${t('final-summary-lines-short')} ▸` : '▸'}
        </Text>
      </Box>
    </Box>
  )
}
