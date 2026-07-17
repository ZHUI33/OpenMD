import type { JSX } from 'react'

import { useEditorTabsStore } from '../stores/editor-tabs-store'

export interface TitleBarProps {
  onInsertImage?: () => void
  insertImageDisabled?: boolean
  onToggleSidebar?: () => void
  onOpenWorkspace?: () => void
  onOpenSearch?: () => void
  onOpenSettings?: () => void
}

export function TitleBar({
  onInsertImage,
  insertImageDisabled = false,
  onToggleSidebar,
  onOpenWorkspace,
  onOpenSearch,
  onOpenSettings,
}: TitleBarProps): JSX.Element {
  const activeTab = useEditorTabsStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  )

  return (
    <header className="title-bar">
      <div className="brand" aria-label="OpenMD">
        <span className="brand-mark" aria-hidden="true">
          M
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
        <button className="title-action-button" type="button" onClick={onOpenSettings}>
          设置
        </button>
      </div>
    </header>
  )
}
