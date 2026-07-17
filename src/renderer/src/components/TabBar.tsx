import { useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'

export interface TabBarItem {
  id: string
  title: string
  dirty: boolean
  filePath?: string
}

export interface TabBarProps {
  tabs: readonly TabBarItem[]
  activeTabId?: string
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseRight: (tabId: string) => void
}

interface ContextMenuState {
  tabId: string
  x: number
  y: number
}

export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
}: TabBarProps): JSX.Element {
  const stripRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  useEffect(() => {
    const activeTab = stripRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeTabId ?? '')}"]`,
    )
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    if (!contextMenu) return
    const closeMenu = (): void => setContextMenu(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  const showContextMenu = (event: ReactMouseEvent, tabId: string): void => {
    event.preventDefault()
    setContextMenu({ tabId, x: event.clientX, y: event.clientY })
  }

  const hasTabsToRight = contextMenu
    ? tabs.findIndex((tab) => tab.id === contextMenu.tabId) < tabs.length - 1
    : false

  const runContextAction = (action: (tabId: string) => void): void => {
    if (!contextMenu) return
    const { tabId } = contextMenu
    setContextMenu(null)
    action(tabId)
  }

  return (
    <div className="tab-bar" aria-label="打开的文档">
      <div ref={stripRef} className="tab-strip" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="editor-tab"
            data-active={tab.id === activeTabId}
            data-tab-id={tab.id}
            role="presentation"
            onContextMenu={(event) => showContextMenu(event, tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(tab.id)
            }}
          >
            <button
              className="editor-tab-main"
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              title={tab.filePath ?? tab.title}
              onClick={() => onActivate(tab.id)}
            >
              <span className="editor-tab-title">{tab.title}</span>
              {tab.dirty ? (
                <span className="editor-tab-dirty" aria-label="未保存">
                  ●
                </span>
              ) : null}
            </button>
            <button
              className="editor-tab-close"
              type="button"
              aria-label={`关闭 ${tab.title}`}
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {contextMenu ? (
        <div
          className="tab-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => runContextAction(onClose)}>
            关闭
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={tabs.length <= 1}
            onClick={() => runContextAction(onCloseOthers)}
          >
            关闭其他
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasTabsToRight}
            onClick={() => runContextAction(onCloseRight)}
          >
            关闭右侧
          </button>
        </div>
      ) : null}
    </div>
  )
}
