/**
 * SidePanelColumn: PanelBar, the active panel surface and a one-row key hint.
 * The hint follows focus, and the rules brighten with the divider as one surface.
 * Tabs follow the enabled registration order and carry each panel's icon and badge.
 */
import React from 'react'
import { Box, Text, useTerminalSize } from '../../ui.js'
import { t } from '../../i18n.js'
import type { ChannelUi } from '../../adapter/channel/ui-policy.js'
import { useSurfaceEdges } from '../SurfaceEdges.js'
import { installedTuiVersion } from '../../update.js'
import { PanelBar, type PanelBarTab } from './PanelBar.js'
import { SidebarMascot } from './SidebarMascot.js'
import { PanelHost } from './PanelHost.js'
import { panelStore } from './PanelStore.js'
import { registerBuiltinPanels } from './builtinPanels.js'
import type { SidePanelController } from './useSidePanel.js'
import { SIDEBAR_BRAND_GAP, SIDEBAR_BRAND_ROWS, SIDEBAR_BRAND_ROWS_LARGE, cycleSidebarLogo, getSidebarLogo, sidebarBrandRows, sidebarMascotRows, subscribeSidebarLogo } from './sidebarBrand.js'

registerBuiltinPanels()

export interface SidePanelColumnProps {
  readonly width: number
  readonly controller: SidePanelController
  readonly channel: ChannelUi
  readonly activity?: import('../../dsh-adapter/activity-store.js').ActivityView
  readonly attention?: { readonly approvals: number; readonly questions: number }
  /** 宿主提供的「全屏」出口（Chat 把活动面板切到整屏形态）。 */
  readonly onExpand?: (panelId: string) => void
  /** 会话轨迹投影（轨迹 Panel 的数据源）。 */
  readonly trajectory?: import('../../dsh-adapter/trajectory/index.js').TrajBuild
  /** Sidebar mascot placement (settings `dsh-tui.sidebarLogoPosition`):
   *  `top` beside the wordmark (default), `bottom` centered at the panel
   *  foot above the hint row. */
  readonly sidebarLogoPosition?: 'top' | 'bottom'
}

function fallbackTitle(id: string): string {
  const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

function Rule({ focused }: { readonly focused: boolean }): React.ReactNode {
  // Structural chrome bleeds: the rule runs past the content column to the
  // terminal's right edge (the panel surface's SurfaceEdges allow right
  // bleed; zero without a page margin, so this is a no-op there).
  const edges = useSurfaceEdges()
  return (
    <Box
      height={1}
      flexShrink={0}
      marginRight={-edges.right}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={focused ? 'accent' : 'inactive'}
    />
  )
}

/** 没有「已启用 ∩ 已注册」面板时的空态。 */
function EmptyNone(): React.ReactNode {
  return (
    <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center" paddingX={1}>
      <Text dimColor wrap="truncate-end">{t('panel-empty-none')}</Text>
    </Box>
  )
}

/** DST Comet brand header: the splash's pixel mascot beside the product mark
 *  and the live model·effort line. Clicking the mascot cycles whale girl →
 *  whale → none (persisted in `~/.dsh-tui/sidebar-logo.json`); the wordmark
 *  keeps a small right indent so it reads as a caption next to the art.
 *  Short terminals drop to a 2-row strip so the transcript keeps its rows. */
function BrandHeader({ width, height, channel, position }: { readonly width: number; readonly height: number; readonly channel: ChannelUi; readonly position: 'top' | 'bottom' }): React.ReactNode {
  // Same memo pattern as Chat's tuiVersion: the call reads installed files,
  // and this column re-renders on every channel emission.
  const version = React.useMemo(() => installedTuiVersion(), [])
  const logo = React.useSyncExternalStore(subscribeSidebarLogo, getSidebarLogo)
  // A 24-column mascot needs a wide sidebar; below that the wordmark takes
  // the full width. The wordmark starts right after the art (one-cell gap).
  const showLogo = position === 'top' && logo !== 'none' && width >= 42
  const mark = `DST·Comet${version !== undefined ? ' v' + version : ''}`
  const meta = [channel.model, channel.reasoningEffort].filter(part => part !== undefined && part !== '').join(' · ')
  const compact = height < SIDEBAR_BRAND_ROWS
  return (
    <Box flexDirection="row" flexShrink={0} paddingX={1} width={width} height={height} overflow="hidden">
      {showLogo && (
        <Box
          flexShrink={0}
          onClick={event => {
            event.stopImmediatePropagation()
            cycleSidebarLogo()
          }}
        >
          <SidebarMascot variant={logo === 'whale' ? 'whale' : 'whaleGirl'} compact={compact} />
        </Box>
      )}
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        paddingLeft={showLogo ? 0 : 2}
        paddingTop={compact ? 0 : 1}
        overflow="hidden"
      >
        <Text bold color="accent" wrap="truncate-end">{mark}</Text>
        <Text dimColor wrap="truncate-end">{meta}</Text>
      </Box>
    </Box>
  )
}

export function SidePanelColumn({ width, controller, channel, activity, attention, onExpand, trajectory, sidebarLogoPosition = 'top' }: SidePanelColumnProps): React.ReactNode {
  const focused = controller.focus === 'panel'
  const { rows } = useTerminalSize()
  const entries = React.useSyncExternalStore(panelStore.subscribe, () => panelStore.list())
  const tabs: PanelBarTab[] = controller.enabledPanelIds.map(id => {
    const entry = entries.find(candidate => candidate.definition.id === id)
    if (entry === undefined) return { id, title: fallbackTitle(id) }
    const def = entry.definition
    return {
      id,
      title: def.titleKey !== undefined ? t(def.titleKey) : def.title ?? fallbackTitle(id),
      icon: def.icon,
      badge: entry.badge,
    }
  })
  const anyRegistered = tabs.length > 0 && entries.length > 0 &&
    controller.enabledPanelIds.some(id => entries.some(entry => entry.definition.id === id))
  // ⤢ 只对「活动面板 + 声明了整屏形态 + 宿主接了出口」出现：能力位是
  // 声明的唯一真源，没有整屏对应物的面板（info/companion）不画。
  const activeEntry = entries.find(entry => entry.definition.id === controller.activePanelId)
  // 没有轨迹来源（unsupported）时收起轨迹的 ⤢：全屏只会放大同一句「不支
  // 持」，面板自己的文案说明了原因。channel 不报告来源（旧夹具/部分
  // channel）时照旧显示。
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: partial fixture channels
  const trajectoryUnsupported = controller.activePanelId === 'trajectory' && channel.trajectorySource?.() === 'unsupported'
  const canExpand = activeEntry?.definition.capabilities?.fullscreen === true && onExpand !== undefined && !trajectoryUnsupported
  // 底栏拼序 = 重要性：导航 → 面板自己绑的键 → 列控制。宿主不点名任何面板：
  // 面板经 panelStore 广告自己此刻的键位（例如 btw 在编辑层只说「↑ 回标题」、
  // 在列表层才说 s/c），没广告过的才退回能力位那一段。窄面板从尾部截断，所以
  // 面板键排在列控制前；未聚焦时面板收不到按键，那一格继续只说怎么把焦点拿过来。
  const panelSegment = activeEntry === undefined
    ? ''
    : activeEntry.hint !== undefined
      ? activeEntry.hint
      : activeEntry.definition.capabilities?.sendToChat === true ? t('panel-hint-send-to-chat') : ''
  const focusedHint = t('panel-hint-focused')
    + (panelSegment === '' ? '' : ' · ' + panelSegment)
    + ' · ' + t('panel-hint-zoom-width')
  // 标签点击与 ←/→ 宿主键走同一条路（openPanel 会顺带把焦点给右栏）。
  const onSelectPanel = React.useCallback(
    (id: string) => { controller.openPanel(id, { focus: true }) },
    // openPanel 在 useSidePanel 里是空依赖 useCallback（引用稳定）；
    // controller 对象本身每次渲染都是新的，不能进依赖表。
    [controller.openPanel],
  )
  // Host 高度 = 列高 - 品牌头（宽屏 9 / 矮屏 3，含 1 行留白）- PanelBar/上规/下规/hint 四行 chrome。
  const brandRows = sidebarBrandRows(rows, width, sidebarLogoPosition)
  // Bottom mascot placement: the mascot occupies its own rows above the
  // bottom rule (one breathing row between host and mascot), so the panel
  // host yields exactly those rows. The bottom placement has no wordmark
  // beside the art, so it fits from 26 columns up — the old 42-col gate
  // hid the mascot on every default-width panel (user ask 2026-10-27),
  // which read as "whalegirl disappeared". A 32-col+ panel renders the
  // large 28×20 sprite.
  const logo = React.useSyncExternalStore(subscribeSidebarLogo, getSidebarLogo)
  const bottomMascot = sidebarLogoPosition === 'bottom' && logo !== 'none' && width >= 26
  const mascotRows = sidebarMascotRows(rows, width)
  const mascotLarge = mascotRows >= SIDEBAR_BRAND_ROWS_LARGE
  const hostHeight = Math.max(1, rows - (brandRows + 4) - (bottomMascot ? mascotRows + 1 : 0))
  return (
    <Box flexDirection="column" width={width} flexGrow={1}>
      <BrandHeader width={width} height={brandRows - SIDEBAR_BRAND_GAP} channel={channel} position={sidebarLogoPosition} />
      <Box height={SIDEBAR_BRAND_GAP} flexShrink={0} />
      <PanelBar
        tabs={tabs}
        activeId={controller.activePanelId}
        width={width}
        focused={focused}
        canExpand={canExpand}
        onExpand={canExpand ? () => onExpand?.(controller.activePanelId ?? '') : undefined}
        onSelect={onSelectPanel}
      />
      <Rule focused={focused} />
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {anyRegistered
          ? (
            <PanelHost
              controller={controller}
              channel={channel}
              width={width}
              height={hostHeight}
              activity={activity}
              attention={attention}
              trajectory={trajectory}
              openFullscreen={onExpand}
            />
          )
          : <EmptyNone />}
      </Box>
      {bottomMascot && (
        // The panel-foot mascot (`dsh-tui.sidebarLogoPosition: bottom`):
        // centered above the bottom rule, one breathing row under the host.
        // Same click cycle as the header placement (girl → whale → none).
        <>
          <Box height={1} flexShrink={0} />
          <Box flexDirection="row" justifyContent="center" height={mascotRows} flexShrink={0}
            onClick={event => {
              event.stopImmediatePropagation()
              cycleSidebarLogo()
            }}
          >
            <SidebarMascot variant={logo === 'whale' ? 'whale' : 'whaleGirl'} compact={mascotRows < SIDEBAR_BRAND_ROWS} size={mascotLarge ? 'large' : 'regular'} />
          </Box>
        </>
      )}
      <Rule focused={focused} />
      <Box height={1} flexShrink={0} paddingX={1} overflow="hidden">
        <Text dimColor wrap="truncate-end">
          {focused ? focusedHint : t('panel-hint-unfocused')}
        </Text>
      </Box>
    </Box>
  )
}
