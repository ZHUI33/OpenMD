import type { ChangeEvent, JSX } from 'react'

import { useAppStore } from '../stores/app-store'
import type { Theme } from '../stores/app-store'

export function TitleBar(): JSX.Element {
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)

  const handleThemeChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setTheme(event.currentTarget.value as Theme)
  }

  return (
    <header className="title-bar">
      <div className="brand" aria-label="OpenMD">
        <span className="brand-mark" aria-hidden="true">
          M
        </span>
        <span className="brand-name">OpenMD</span>
      </div>

      <label className="theme-control">
        <span>主题</span>
        <select aria-label="主题" value={theme} onChange={handleThemeChange}>
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </label>
    </header>
  )
}
