import { useEffect } from 'react'
import type { JSX } from 'react'

import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { EditorPlaceholder } from './editor/EditorPlaceholder'
import { useAppStore } from './stores/app-store'

function App(): JSX.Element {
  const theme = useAppStore((state) => state.theme)

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = (): void => {
      const resolvedTheme = theme === 'system' ? (colorScheme.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolvedTheme
      document.documentElement.style.colorScheme = resolvedTheme
    }

    applyTheme()
    colorScheme.addEventListener('change', applyTheme)

    return () => {
      colorScheme.removeEventListener('change', applyTheme)
    }
  }, [theme])

  return (
    <div className="app-shell">
      <TitleBar />
      <main className="workspace" aria-label="编辑工作区">
        <EditorPlaceholder />
      </main>
      <StatusBar />
    </div>
  )
}

export default App
