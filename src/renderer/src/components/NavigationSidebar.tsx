import { useEffect, useRef } from 'react'
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { SETTINGS_LIMITS } from '../../../shared/settings'
import type { SidebarPanel } from '../../../shared/settings'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { clampSidebarWidth } from './sidebar-layout'

interface NavigationSidebarProps {
  panel: SidebarPanel
  width: number
  files: ReactNode
  search: ReactNode
  outline: ReactNode
  onPanelChange: (panel: SidebarPanel) => void
  onCollapse: () => void
  onWidthChange: (width: number) => void
}

const panelItems: readonly {
  id: SidebarPanel
  icon: IconName
  label: string
}[] = [
  { id: 'files', icon: 'files', label: '文件' },
  { id: 'search', icon: 'search', label: '搜索' },
  { id: 'outline', icon: 'outline', label: '大纲' },
]

export function NavigationSidebar({
  panel,
  width,
  files,
  search,
  outline,
  onPanelChange,
  onCollapse,
  onWidthChange,
}: NavigationSidebarProps): JSX.Element {
  const asideRef = useRef<HTMLElement>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = asideRef.current?.getBoundingClientRect().width ?? width
    const layout = asideRef.current?.closest<HTMLElement>('.workspace-layout')
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    document.documentElement.dataset.sidebarResizing = 'true'

    const update = (pointerEvent: PointerEvent): void => {
      const nextWidth = clampSidebarWidth(startWidth + pointerEvent.clientX - startX)
      layout?.style.setProperty('--sidebar-width', `${nextWidth}px`)
      handle.setAttribute('aria-valuenow', String(nextWidth))
    }
    const finish = (pointerEvent: PointerEvent): void => {
      const nextWidth = clampSidebarWidth(startWidth + pointerEvent.clientX - startX)
      cleanup()
      onWidthChange(nextWidth)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      delete document.documentElement.dataset.sidebarResizing
      dragCleanupRef.current = null
    }
    dragCleanupRef.current?.()
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', update)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const panelContent: Record<SidebarPanel, ReactNode> = { files, search, outline }

  return (
    <aside
      ref={asideRef}
      className="navigation-sidebar"
      aria-label="导航侧栏"
      style={{ '--sidebar-width': `${clampSidebarWidth(width)}px` } as CSSProperties}
    >
      <header className="navigation-sidebar-tabs">
        <div className="navigation-sidebar-tablist" role="tablist" aria-label="侧栏面板">
          {panelItems.map((item) => (
            <button
              key={item.id}
              className="navigation-sidebar-tab"
              type="button"
              role="tab"
              aria-selected={panel === item.id}
              aria-label={item.label}
              title={item.label}
              onClick={() => onPanelChange(item.id)}
            >
              <Icon name={item.icon} />
            </button>
          ))}
        </div>
        <button
          className="icon-button navigation-sidebar-collapse"
          type="button"
          aria-label="隐藏侧栏"
          title="隐藏侧栏"
          onClick={onCollapse}
        >
          <Icon name="sidebar" />
        </button>
      </header>
      <div className="navigation-sidebar-content" role="tabpanel" aria-label={panel}>
        {panelContent[panel]}
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="调整侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={SETTINGS_LIMITS.sidebarWidthPx.min}
        aria-valuemax={SETTINGS_LIMITS.sidebarWidthPx.max}
        aria-valuenow={clampSidebarWidth(width)}
        tabIndex={0}
        onPointerDown={beginResize}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            onWidthChange(clampSidebarWidth(width - step))
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            onWidthChange(clampSidebarWidth(width + step))
          } else if (event.key === 'Home') {
            event.preventDefault()
            onWidthChange(SETTINGS_LIMITS.sidebarWidthPx.min)
          } else if (event.key === 'End') {
            event.preventDefault()
            onWidthChange(SETTINGS_LIMITS.sidebarWidthPx.max)
          }
        }}
      />
    </aside>
  )
}
