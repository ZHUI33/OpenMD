import type { JSX } from 'react'

import { useAppStore } from '../stores/app-store'

export function StatusBar(): JSX.Element {
  const { wordCount, characterCount, dirty } = useAppStore((state) => state.document)
  const editorMode = useAppStore((state) => state.editorMode)
  const sourceCursor = useAppStore((state) => state.sourceCursor)

  return (
    <footer className="status-bar">
      <span>{dirty ? '已修改' : '就绪'}</span>
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
