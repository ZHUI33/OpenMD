import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { useEditorTabsStore } from '../stores/editor-tabs-store'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export interface TitleBarProps {
  sidebarVisible: boolean
  onInsertImage?: () => void
  insertImageDisabled?: boolean
  onToggleSidebar?: () => void
  onOpenWorkspace?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onExportHtml?: () => void
  onExportPdf?: () => void
  onExportPng?: () => void
  onRepeatExport?: () => void
  repeatExportDisabled?: boolean
}

interface IconActionProps {
  icon: IconName
  label: string
  pressed?: boolean
  disabled?: boolean
  className?: string
  onClick?: () => void
}

function IconAction({
  icon,
  label,
  pressed,
  disabled,
  className = '',
  onClick,
}: IconActionProps): JSX.Element {
  return (
    <button
      className={`icon-button ${className}`.trim()}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  )
}

export function TitleBar({
  sidebarVisible,
  onInsertImage,
  insertImageDisabled = false,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSearch,
  onOpenSettings,
  onExportHtml,
  onExportPdf,
  onExportPng,
  onRepeatExport,
  repeatExportDisabled = true,
}: TitleBarProps): JSX.Element {
  const activeTab = useEditorTabsStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  )
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !menuButtonRef.current?.contains(event.target)
      ) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
      ].filter((item) => !item.disabled)
      if (items.length === 0) return
      event.preventDefault()
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
      const nextIndex =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : event.key === 'ArrowDown'
              ? (currentIndex + 1 + items.length) % items.length
              : (currentIndex - 1 + items.length) % items.length
      items[nextIndex]?.focus()
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKeyDown)
    queueMicrotask(() =>
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus(),
    )
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const runMenuAction = (action?: () => void): void => {
    setMenuOpen(false)
    action?.()
  }

  return (
    <header className="title-bar">
      <div className="brand" aria-label="OpenMD">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" focusable="false">
            <path d="M5.5 22V9.5l5.3 6.7 5.3-6.7V22" />
            <path className="brand-mark__arrow" d="M24 9.5v12.4m-3.9-3.8 3.9 4 3.9-4" />
          </svg>
        </span>
        <span className="brand-name">
          {activeTab ? `${activeTab.title}${activeTab.dirty ? ' *' : ''} — OpenMD` : 'OpenMD'}
        </span>
      </div>

      <div className="title-actions" aria-label="应用操作">
        <IconAction
          icon="sidebar"
          label={sidebarVisible ? '隐藏侧栏' : '显示侧栏'}
          pressed={sidebarVisible}
          onClick={onToggleSidebar}
        />
        <IconAction
          icon="folder-open"
          label="打开文件夹 (Ctrl/Cmd+Shift+O)"
          className="title-action--responsive"
          onClick={onOpenWorkspace}
        />
        <IconAction
          icon="search"
          label="工作区搜索 (Ctrl/Cmd+Shift+F)"
          className="title-action--wide"
          onClick={onOpenSearch}
        />
        <div className="title-more">
          <button
            ref={menuButtonRef}
            className="icon-button"
            type="button"
            aria-label="更多操作"
            title="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          {menuOpen ? (
            <div ref={menuRef} className="desktop-menu title-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenWorkspace)}>
                <Icon name="folder-open" />
                <span>打开文件夹…</span>
                <kbd>Ctrl/Cmd ⇧ O</kbd>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenSearch)}>
                <Icon name="search" />
                <span>工作区搜索</span>
                <kbd>Ctrl/Cmd ⇧ F</kbd>
              </button>
              <div className="desktop-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={insertImageDisabled}
                onClick={() => runMenuAction(onInsertImage)}
              >
                <Icon name="image" />
                <span>插入图片…</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onExportHtml)}>
                <Icon name="export" />
                <span>导出 HTML…</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onExportPdf)}>
                <Icon name="export" />
                <span>导出 PDF…</span>
              </button>
              <button type="button" role="menuitem" onClick={() => runMenuAction(onExportPng)}>
                <Icon name="export" />
                <span>导出长图 PNG…</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={repeatExportDisabled}
                onClick={() => runMenuAction(onRepeatExport)}
              >
                <Icon name="export" />
                <span>使用上次配置再次导出</span>
              </button>
              <div className="desktop-menu-separator" role="separator" />
              <button type="button" role="menuitem" onClick={() => runMenuAction(onOpenSettings)}>
                <Icon name="settings" />
                <span>设置…</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
