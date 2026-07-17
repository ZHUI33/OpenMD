import type { ChangeEvent, JSX } from 'react'

import { formatDocumentTitle } from '../../../shared/document-utils'
import { useAppStore } from '../stores/app-store'
import type { Theme } from '../stores/app-store'

export interface TitleBarProps {
  onInsertImage?: () => void
  insertImageDisabled?: boolean
}

export function TitleBar({
  onInsertImage,
  insertImageDisabled = false,
}: TitleBarProps): JSX.Element {
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)
  const dirty = useAppStore((state) => state.document.dirty)
  const filePath = useAppStore((state) => state.document.filePath)

  const handleThemeChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setTheme(event.currentTarget.value as Theme)
  }

  return (
    <header className="title-bar">
      <div className="brand" aria-label="OpenMD">
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <span className="brand-name">{formatDocumentTitle(filePath, dirty)}</span>
      </div>

      <div className="title-actions">
        <button
          className="insert-image-button"
          type="button"
          disabled={insertImageDisabled}
          title={insertImageDisabled ? '请切换到所见即所得模式后插入图片' : undefined}
          onClick={onInsertImage}
        >
          插入图片
        </button>
        <label className="theme-control">
          <span>主题</span>
          <select aria-label="主题" value={theme} onChange={handleThemeChange}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </div>
    </header>
  )
}
