import type { JSX } from 'react'

import { countCharacters, countWords, useAppStore } from '../stores/app-store'
import { useEditorTabsStore } from '../stores/editor-tabs-store'

export function StatusBar(): JSX.Element {
  const activeTab = useEditorTabsStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  )
  const sourceCursor = useAppStore((state) => state.sourceCursor)
  const legacyDocument = useAppStore((state) => state.document)
  const legacyEditorMode = useAppStore((state) => state.editorMode)
  const markdown = activeTab?.markdown ?? legacyDocument.markdown
  const wordCount = countWords(markdown)
  const characterCount = countCharacters(markdown)
  const editorMode = activeTab?.editorMode ?? legacyEditorMode

  return (
    <footer className="status-bar">
      <span>{(activeTab?.dirty ?? legacyDocument.dirty) ? '已修改' : '就绪'}</span>
      <span>{editorMode === 'visual' ? '所见即所得' : 'Markdown 源码'}</span>
      {editorMode === 'source' ? (
        <span>
          行 {sourceCursor.line} · 列 {sourceCursor.column} · {characterCount} 字符
        </span>
      ) : (
        <span>
          {wordCount} 字 · {characterCount} 字符
        </span>
      )}
    </footer>
  )
}
