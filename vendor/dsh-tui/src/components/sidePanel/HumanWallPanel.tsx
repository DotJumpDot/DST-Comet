/**
 * DST-Comet: the Human wall panel — the human's inbox for agent asks.
 *
 * Live-run gap (user ask 2026-10-27): a human-gated step (captcha, login,
 * email code) used to scroll away inside the transcript while other lanes
 * kept streaming, so the human scrolled hunting for it. The queue already
 * lives durably in the session log (the engine mirrors every ask onto the
 * team board as `[human] …` with a human-meta footer); this panel projects
 * it into a pinned side-panel tab where the ask cannot scroll away, and
 * gives it buttons: resolve (done/failed), reply, open the preserved URL,
 * and jump to the owning Chrome window. Only the asking lane parks — the
 * rest of the team keeps working, so the panel is a queue, not a modal.
 */
import React from 'react'
import { Box, Text } from '../../ui.js'
import { t } from '../../i18n.js'
import { useSidePanelChannel, useSidePanelFocusChat } from './SidePanelRuntimeContext.js'
import { usePanelInput } from './usePanelInput.js'
import { panelStore } from './PanelStore.js'
import type { PanelProps } from './types.js'
import { humanWallItems, ownerWindowLabel, type HumanWallItem } from './humanWall.js'
import { openExternal } from '../../utils/openExternal.js'
import { focusWindowTitled } from '../../utils/focusWindow.js'

export function HumanWallPanel({ focused, visible }: PanelProps): React.ReactNode {
  const channel = useSidePanelChannel()
  const focusChat = useSidePanelFocusChat()
  const [selected, setSelected] = React.useState(0)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const version = channel.version
  const items = React.useMemo(() => humanWallItems(channel.team), [channel.team, version])
  const openCount = React.useMemo(() => items.filter(item => item.open).length, [items])
  // Clamp when resolved rows fold away so the cursor never points past the list.
  const index = items.length === 0 ? 0 : Math.min(selected, items.length - 1)
  const current = items[index]

  React.useEffect(() => {
    panelStore.setBadge('human', openCount > 0 ? { level: 'error', unread: openCount } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- badge derives from the projected items
  }, [openCount, visible])

  // The TUI cannot call engine tools directly: resolve/reply ride the normal
  // user-message seam, which is exactly how the human answered these asks in
  // chat before the panel existed (the Lead reads it and calls
  // human_task_resolve, then re-verifies done_when itself).
  const resolve = (item: HumanWallItem, outcome: 'done' | 'failed'): void => {
    channel.submit(t(`human-wall-resolve-${outcome}`, {
      id: item.humanId ?? item.id,
      title: item.title,
      done: item.doneWhen === '' ? t('human-wall-done-unavailable') : item.doneWhen,
    }))
    setExpandedId(null)
  }

  const attachSummary = (item: HumanWallItem): void => {
    if (typeof channel.attachContext !== 'function') return
    const content = [
      ...item.steps.map((step, at) => `${at + 1}. ${step}`),
      ...(item.doneWhen === '' ? [] : [t('human-wall-context-done', { done: item.doneWhen })]),
      ...(item.preserveUrl === undefined ? [] : [item.preserveUrl]),
    ].join('\n')
    channel.attachContext({
      source: 'panel',
      sourceId: item.id,
      title: t('human-wall-context-heading', { title: item.title }),
      content,
    })
    channel.notify(t('human-wall-attached', { title: item.title }), { color: 'success' })
    focusChat?.()
  }

  usePanelInput((input, key) => {
    if (key.ctrl || key.meta) return false
    if (key.escape === true) {
      if (expandedId !== null) {
        setExpandedId(null)
        return true
      }
      return false
    }
    if (key.upArrow === true) {
      setSelected(Math.max(0, index - 1))
      return true
    }
    if (key.downArrow === true) {
      setSelected(Math.min(items.length - 1, index + 1))
      return true
    }
    const item = current
    if (item === undefined) return false
    if (key.return_ === true) {
      setExpandedId(expandedId === item.id ? null : item.id)
      return true
    }
    if (input === 'd' && item.open) {
      resolve(item, 'done')
      return true
    }
    if (input === 'f' && item.open) {
      resolve(item, 'failed')
      return true
    }
    if (input === 'm') {
      attachSummary(item)
      return true
    }
    if (input === 'o' && item.preserveUrl !== undefined) {
      openExternal(item.preserveUrl)
      return true
    }
    if (input === 'w') {
      focusWindowTitled(ownerWindowLabel(item))
      return true
    }
    return false
  }, { active: focused && visible })

  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>{t('human-wall-empty')}</Text>
      </Box>
    )
  }

  const actionChip = (label: string, onActivate: () => void, color?: 'accent' | 'error' | 'subtle' | 'success'): React.ReactNode => (
    <Box flexShrink={0} onClick={onActivate}>
      <Text color={color} bold>{` ${label} `}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {items.map((item, at) => {
        const isCurrent = at === index
        const expanded = expandedId === item.id
        const lane = item.lane ?? item.member
        return (
          <React.Fragment key={item.id}>
            <Box
              flexDirection="row"
              onClick={() => {
                setSelected(at)
                setExpandedId(expanded ? null : item.id)
              }}
            >
              <Box flexShrink={0} marginRight={1}>
                <Text color={item.open ? 'error' : 'subtle'}>{item.open ? '⚠' : '●'}</Text>
              </Box>
              <Box flexShrink={0} marginRight={1}>
                <Text color={isCurrent ? 'accent' : undefined} bold={isCurrent}>{isCurrent ? '›' : ' '}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text
                  color={isCurrent ? 'accent' : undefined}
                  bold={isCurrent && item.open}
                  dimColor={!item.open}
                  wrap="truncate-end"
                >
                  {`${lane === undefined ? '' : `[${lane}] `}${item.title}`}
                </Text>
              </Box>
              {item.member !== undefined && (
                <Box flexShrink={0} marginLeft={1}>
                  <Text dimColor>{`← ${item.member}`}</Text>
                </Box>
              )}
            </Box>
            {expanded && (
              <Box flexDirection="column" paddingLeft={4}>
                {item.steps.map((step, stepAt) => (
                  <Box key={stepAt} flexDirection="row">
                    <Box flexShrink={0} marginRight={1}><Text dimColor>{`${stepAt + 1}.`}</Text></Box>
                    <Text wrap="wrap">{step}</Text>
                  </Box>
                ))}
                {item.doneWhen !== '' && (
                  <Text dimColor>{t('human-wall-done-when', { done: item.doneWhen })}</Text>
                )}
                {!item.parked && (
                  <Text color="subtle">{t('human-wall-not-parked')}</Text>
                )}
                {item.preserveUrl !== undefined && (
                  <Text color="accent" underline={false}>{item.preserveUrl}</Text>
                )}
                {item.open && (
                  <Box flexDirection="row" marginTop={0}>
                    {actionChip(t('human-wall-action-done'), () => resolve(item, 'done'), 'success')}
                    <Text dimColor>│</Text>
                    {actionChip(t('human-wall-action-failed'), () => resolve(item, 'failed'), 'error')}
                    <Text dimColor>│</Text>
                    {actionChip(t('human-wall-action-reply'), () => attachSummary(item), 'accent')}
                    {item.preserveUrl !== undefined && (
                      <>
                        <Text dimColor>│</Text>
                        {actionChip(t('human-wall-action-open'), () => openExternal(item.preserveUrl!))}
                      </>
                    )}
                    <Text dimColor>│</Text>
                    {actionChip(t('human-wall-action-chrome'), () => focusWindowTitled(ownerWindowLabel(item)))}
                  </Box>
                )}
              </Box>
            )}
          </React.Fragment>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>{t('human-wall-hint')}</Text>
      </Box>
    </Box>
  )
}
