import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { DocumentController } from './document-controller'
import { OpenMdEditor } from './editor/OpenMdEditor'
import type { OpenMdEditorHandle } from './editor/editor.types'
import { useAppStore } from './stores/app-store'
import { formatDocumentTitle } from '../../shared/document-utils'

function App(): JSX.Element {
  const theme = useAppStore((state) => state.theme)
  const updateMarkdown = useAppStore((state) => state.updateMarkdown)
  const dirty = useAppStore((state) => state.document.dirty)
  const filePath = useAppStore((state) => state.document.filePath)
  const editorRef = useRef<OpenMdEditorHandle>(null)
  const controllerRef = useRef<DocumentController>(null)

  if (!controllerRef.current) {
    controllerRef.current = new DocumentController(window.openmd.documents, () => editorRef.current)
  }

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

  useEffect(() => {
    document.title = formatDocumentTitle(filePath, dirty)
  }, [dirty, filePath])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return

    const removeListener = window.openmd.documents.onCommand((command) => {
      void controller.handleCommand(command)
    })
    void window.openmd.documents.ready().catch((error: unknown) => {
      console.error('Failed to register the document command listener:', error)
    })

    return removeListener
  }, [])

  return (
    <div className="app-shell">
      <TitleBar />
      <main className="workspace" aria-label="编辑工作区">
        <OpenMdEditor
          ref={editorRef}
          initialMarkdown={useAppStore.getState().document.markdown}
          onChange={updateMarkdown}
        />
      </main>
      <StatusBar />
    </div>
  )
}

export default App
