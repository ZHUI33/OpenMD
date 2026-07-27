import { useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from './Icon'

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
  const pendingFocusTabIdRef = useRef<string | undefined>(undefined)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const findTabButton = (tabId: string): HTMLButtonElement | undefined => {
    const tabElement = [
      ...(stripRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []),
    ].find((element) => element.dataset.tabId === tabId)
    return tabElement?.querySelector<HTMLButtonElement>('.editor-tab-main') ?? undefined
  }

  useEffect(() => {
    const activeTab = findTabButton(activeTabId ?? '')?.parentElement
    activeTab?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  useEffect(() => {
    const pendingTabId = pendingFocusTabIdRef.current
    if (!pendingTabId || !tabs.some((tab) => tab.id === pendingTabId)) return
    pendingFocusTabIdRef.current = undefined
    findTabButton(pendingTabId)?.focus()
  }, [tabs])

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

  const focusTabAt = (index: number): void => {
    const tab = tabs[(index + tabs.length) % tabs.length]
    if (!tab) return
    onActivate(tab.id)
    findTabButton(tab.id)?.focus()
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
              tabIndex={tab.id === activeTabId ? 0 : -1}
              title={tab.filePath ?? tab.title}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => {
                const index = tabs.findIndex((candidate) => candidate.id === tab.id)
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  focusTabAt(index + (event.key === 'ArrowRight' ? 1 : -1))
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  focusTabAt(0)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  focusTabAt(tabs.length - 1)
                } else if (event.key === 'Delete') {
                  event.preventDefault()
                  pendingFocusTabIdRef.current = tabs[index + 1]?.id ?? tabs[index - 1]?.id
                  onClose(tab.id)
                } else if (event.key === 'F10' && event.shiftKey) {
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  setContextMenu({ tabId: tab.id, x: rect.left, y: rect.bottom })
                }
              }}
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
              title={`关闭 ${tab.title}`}
              onClick={() => onClose(tab.id)}
            >
              <Icon name="close" size={14} />
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
