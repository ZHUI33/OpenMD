import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { DocumentController } from './document-controller'
import { OpenMdEditor } from './editor/OpenMdEditor'
import type { OpenMdEditorHandle, ResolvedTheme } from './editor/editor.types'
import { useAppStore } from './stores/app-store'
import { formatDocumentTitle } from '../../shared/document-utils'

function App(): JSX.Element {
  const theme = useAppStore((state) => state.theme)
  const editorMode = useAppStore((state) => state.editorMode)
  const sourceLineNumbers = useAppStore((state) => state.sourceLineNumbers)
  const sourceLineWrapping = useAppStore((state) => state.sourceLineWrapping)
  const setEditorMode = useAppStore((state) => state.setEditorMode)
  const setSourceLineNumbers = useAppStore((state) => state.setSourceLineNumbers)
  const setSourceLineWrapping = useAppStore((state) => state.setSourceLineWrapping)
  const setSourceCursor = useAppStore((state) => state.setSourceCursor)
  const updateMarkdown = useAppStore((state) => state.updateMarkdown)
  const dirty = useAppStore((state) => state.document.dirty)
  const filePath = useAppStore((state) => state.document.filePath)
  const editorRef = useRef<OpenMdEditorHandle>(null)
  const controllerRef = useRef<DocumentController>(null)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')

  if (!controllerRef.current) {
    controllerRef.current = new DocumentController(window.openmd.documents, () => editorRef.current)
  }

  useEffect(() => {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = (): void => {
      const resolvedTheme = theme === 'system' ? (colorScheme.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolvedTheme
      document.documentElement.style.colorScheme = resolvedTheme
      setResolvedTheme(resolvedTheme)
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
      <TitleBar
        insertImageDisabled={editorMode === 'source'}
        onInsertImage={() => void editorRef.current?.insertImageFromPicker()}
      />
      <main className="workspace" aria-label="编辑工作区">
        <OpenMdEditor
          ref={editorRef}
          initialMarkdown={useAppStore.getState().document.markdown}
          initialMode={editorMode}
          initialSourceLineNumbers={sourceLineNumbers}
          initialSourceLineWrapping={sourceLineWrapping}
          resolvedTheme={resolvedTheme}
          documentPath={filePath}
          imagesApi={window.openmd.images}
          onEnsureDocumentSaved={() =>
            controllerRef.current?.ensureDocumentSaved() ?? Promise.resolve(undefined)
          }
          onChange={updateMarkdown}
          onModeChange={setEditorMode}
          onSourceCursorChange={setSourceCursor}
          onSourceLineNumbersChange={setSourceLineNumbers}
          onSourceLineWrappingChange={setSourceLineWrapping}
        />
      </main>
      <StatusBar />
    </div>
  )
}

export default App
