import React from 'react'
import Box from '../ink/components/Box.js'
import { Text } from '../ui.js'
import { useBlink } from '../hooks/useBlink.js'
import { BLACK_CIRCLE, BULLET, MULTIPLICATION_X } from '../terminal-utils/figures.js'
import type { Theme } from '../theme.js'
import { toolToneColor, toolToneFamily } from './messages/toolTone.js'

type Props = {
  isError: boolean
  isUnresolved: boolean
  shouldAnimate: boolean
  /** Raw tool id (bash/read/grep/…) — picks the family colour for a settled dot. */
  toolName?: string
  /** Backend-declared colour family (mutate/exec/other), when the view has one. */
  toolCategory?: 'mutate' | 'exec' | 'other'
}

/**
 * The status dot on tool-call rows. State shapes the glyph, the tool
 * family picks the settled color (DST Comet: Read cyan, Grep violet, Pwsh
 * green, MCP rose — the same family tokens the card title and wash use):
 * blinking `●` while running (attention), a smaller family-colored `•` once
 * settled (quiet), and a red `✗` on error — a glyph swap, not just a hue, so
 * failures read at a glance (Codex-style category colors; every color is a
 * theme token).
 */
export function ToolUseLoader({
  isError,
  isUnresolved,
  shouldAnimate,
  toolName,
  toolCategory,
}: Props): React.ReactNode {
  const [ref, isBlinking] = useBlink(shouldAnimate)
  if (isError) {
    return (
      <Box ref={ref} minWidth={2}>
        <Text color="error">{MULTIPLICATION_X}</Text>
      </Box>
    )
  }
  const token: keyof Theme = toolToneColor(toolToneFamily(toolName ?? '', toolCategory))
  const color = isUnresolved ? undefined : token
  const char = shouldAnimate ? (isBlinking ? BLACK_CIRCLE : ' ') : BULLET

  return (
    <Box ref={ref} minWidth={2}>
      <Text color={color} dimColor={isUnresolved}>
        {char}
      </Text>
    </Box>
  )
}
