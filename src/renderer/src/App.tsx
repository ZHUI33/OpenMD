import { useEffect } from 'react'
import type { JSX } from 'react'

import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { OpenMdEditor } from './editor/OpenMdEditor'
import { useAppStore } from './stores/app-store'

function App(): JSX.Element {
  const theme = useAppStore((state) => state.theme)
  const updateMarkdown = useAppStore((state) => state.updateMarkdown)

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
        <OpenMdEditor
          initialMarkdown={useAppStore.getState().document.markdown}
          onChange={updateMarkdown}
        />
      </main>
      <StatusBar />
    </div>
  )
}

export default App
