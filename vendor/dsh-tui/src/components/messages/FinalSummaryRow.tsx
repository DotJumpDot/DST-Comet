/**
 * DST Comet final-summary row: the settled assistant answer of a turn that
 * used tools is DECORATED IN PLACE at the end of that turn — where it
 * streamed — and renders ALWAYS EXPANDED (`✓ Final summary` header + the
 * full Markdown body). The answer is the deliverable the user watches for,
 * so it never folds behind a `▸` while the tool cards and thinking blocks
 * stay collapsible, and it never moves (relocating it teleported the text
 * out of the viewport on long turns). The transcript keeps the original
 * session-event order; see MessageList's `promoteFinalSummaries`.
 *
 * No standing background: plain text on the transcript, only the row's
 * message-selection highlight may paint (isSelected).
 */
import React from 'react'
import { Box, Text } from '../../ui.js'
import { Markdown } from '../Markdown.js'
import { t } from '../../i18n.js'

export interface FinalSummaryRowProps {
  readonly text: string
  readonly isSelected?: boolean
}

export function FinalSummaryRow({ text, isSelected = false }: FinalSummaryRowProps): React.ReactNode {
  const trimmed = text.trim()
  const lines = trimmed === '' ? 0 : trimmed.split('\n').length
  return (
    <Box
      flexDirection="column"
      width="100%"
      backgroundColor={isSelected ? 'messageActionsBackground' : undefined}
      paddingLeft={1}
    >
      <Box flexDirection="row">
        <Box minWidth={2} flexShrink={0}>
          <Text color="success">✓</Text>
        </Box>
        <Text bold color="success">{t('final-summary-title')}</Text>
        {lines > 1 && <Text dimColor>{` · ${t('final-summary-lines', { n: lines })}`}</Text>}
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        <Markdown>{text}</Markdown>
      </Box>
    </Box>
  )
}
