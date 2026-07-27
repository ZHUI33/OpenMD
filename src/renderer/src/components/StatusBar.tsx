import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import { countCharacters, countWords } from '../document-statistics'
import { useAppStore } from '../stores/app-store'
import { useEditorTabsStore } from '../stores/editor-tabs-store'

export function StatusBar(): JSX.Element {
  const activeTab = useEditorTabsStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  )
  const sourceCursor = useAppStore((state) => state.sourceCursor)
  const legacyDocument = useAppStore((state) => state.document)
  const legacyEditorMode = useAppStore((state) => state.editorMode)
  const markdown = activeTab?.markdown ?? legacyDocument.markdown
  const [statistics, setStatistics] = useState(() => ({
    wordCount: countWords(markdown),
    characterCount: countCharacters(markdown),
  }))
  const workerRef = useRef<Worker | undefined>(undefined)
  const revisionRef = useRef(0)
  const editorMode = activeTab?.editorMode ?? legacyEditorMode

  useEffect(() => {
    if (typeof Worker === 'undefined') return
    const worker = new Worker(
      new URL('../workers/document-statistics-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    )
    workerRef.current = worker
    worker.addEventListener(
      'message',
      (
        event: MessageEvent<{
          revision: number
          wordCount: number
          characterCount: number
        }>,
      ) => {
        if (event.data.revision !== revisionRef.current) return
        setStatistics({
          wordCount: event.data.wordCount,
          characterCount: event.data.characterCount,
        })
      },
    )
    worker.addEventListener('error', () => {
      worker.terminate()
      workerRef.current = undefined
    })
    return () => {
      worker.terminate()
      workerRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const revision = ++revisionRef.current
    const timer = window.setTimeout(() => {
      const worker = workerRef.current
      if (worker) {
        worker.postMessage({ revision, markdown })
        return
      }
      const calculate = (): void => {
        if (revision !== revisionRef.current) return
        setStatistics({
          wordCount: countWords(markdown),
          characterCount: countCharacters(markdown),
        })
      }
      const scheduleIdle = window.requestIdleCallback?.bind(window)
      if (scheduleIdle) {
        scheduleIdle(calculate, { timeout: 500 })
      } else {
        globalThis.setTimeout(calculate, 0)
      }
    }, 120)
    return () => window.clearTimeout(timer)
  }, [markdown])

  return (
    <footer className="status-bar">
      <span>{(activeTab?.dirty ?? legacyDocument.dirty) ? '已修改' : '就绪'}</span>
      <span>{editorMode === 'visual' ? '所见即所得' : 'Markdown 源码'}</span>
      {editorMode === 'source' ? (
        <span>
          行 {sourceCursor.line} · 列 {sourceCursor.column} · {statistics.characterCount} 字符
        </span>
      ) : (
        <span>
          {statistics.wordCount} 字 · {statistics.characterCount} 字符
        </span>
      )}
    </footer>
  )
}
