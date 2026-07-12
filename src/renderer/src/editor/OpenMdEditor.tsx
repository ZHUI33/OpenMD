import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { JSX } from 'react'

import { OpenMdEditorAdapter } from './editor-adapter'
import type { OpenMdEditorHandle, OpenMdEditorProps } from './editor.types'

const CHANGE_DEBOUNCE_MS = 180

export const OpenMdEditor = forwardRef<OpenMdEditorHandle, OpenMdEditorProps>(function OpenMdEditor(
  { initialMarkdown = '', readOnly = false, onChange },
  forwardedRef,
): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<OpenMdEditorAdapter | null>(null)
  const initialMarkdownRef = useRef(initialMarkdown)
  const initialReadOnlyRef = useRef(readOnly)
  const onChangeRef = useRef(onChange)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  onChangeRef.current = onChange

  useImperativeHandle(
    forwardedRef,
    () => ({
      getMarkdown: () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        const markdown = adapterRef.current?.getMarkdown() ?? initialMarkdownRef.current
        initialMarkdownRef.current = markdown
        return markdown
      },
      setMarkdown: (markdown) => {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        initialMarkdownRef.current = markdown
        adapterRef.current?.setMarkdown(markdown)
      },
      setReadOnly: (nextReadOnly) => adapterRef.current?.setReadOnly(nextReadOnly),
      focus: () => adapterRef.current?.focus(),
    }),
    [],
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const adapter = new OpenMdEditorAdapter({
      root,
      initialMarkdown: initialMarkdownRef.current,
      readOnly: initialReadOnlyRef.current,
      onChange: (markdown) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          onChangeRef.current?.(markdown)
        }, CHANGE_DEBOUNCE_MS)
      },
    })
    adapterRef.current = adapter
    void adapter.create()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      adapterRef.current = null
      void adapter.destroy()
    }
  }, [])

  useEffect(() => {
    adapterRef.current?.setReadOnly(readOnly)
  }, [readOnly])

  return <div ref={rootRef} className="openmd-editor" aria-label="Markdown 正文编辑器" />
})
