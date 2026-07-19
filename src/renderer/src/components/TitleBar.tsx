import type { JSX } from 'react'

import { useEditorTabsStore } from '../stores/editor-tabs-store'

export interface TitleBarProps {
  onInsertImage?: () => void
  insertImageDisabled?: boolean
  onToggleSidebar?: () => void
  onOpenWorkspace?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
  onExportHtml?: () => void
  onExportPdf?: () => void
}

export function TitleBar({
  onInsertImage,
  insertImageDisabled = false,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSearch,
  onOpenSettings,
  onExportHtml,
  onExportPdf,
}: TitleBarProps): JSX.Element {
  const activeTab = useEditorTabsStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  )

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

      <div className="title-actions">
        <button className="title-action-button" type="button" onClick={onToggleSidebar}>
          文件树
        </button>
        <button
          className="title-action-button"
          type="button"
          title="打开文件夹 (Ctrl/Cmd+Shift+O)"
          onClick={onOpenWorkspace}
        >
          打开文件夹
        </button>
        <button
          className="title-action-button"
          type="button"
          title="全文搜索 (Ctrl/Cmd+Shift+F)"
          onClick={onOpenSearch}
        >
          搜索
        </button>
        <button
          className="title-action-button"
          type="button"
          disabled={insertImageDisabled}
          title={insertImageDisabled ? '请切换到所见即所得模式后插入图片' : undefined}
          onClick={onInsertImage}
        >
          插入图片
        </button>
        <button className="title-action-button" type="button" onClick={onExportHtml}>
          导出 HTML
        </button>
        <button className="title-action-button" type="button" onClick={onExportPdf}>
          导出 PDF
        </button>
        <button className="title-action-button" type="button" onClick={onOpenSettings}>
          设置
        </button>
      </div>
    </header>
  )
}
