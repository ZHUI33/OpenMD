import type { JSX } from 'react'

import { useAppStore } from '../stores/app-store'

export function StatusBar(): JSX.Element {
  const { wordCount, characterCount, dirty } = useAppStore((state) => state.document)

  return (
    <footer className="status-bar">
      <span>{dirty ? '已修改' : '就绪'}</span>
      <span>
        {wordCount} 字 · {characterCount} 字符
      </span>
    </footer>
  )
}
