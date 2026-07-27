import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { JSX } from 'react'

import { OpenMdEditorAdapter } from './editor-adapter'
import { EditorModeCoordinator } from './editor-coordinator'
import type {
  EditorMode,
  OpenMdEditorHandle,
  OpenMdEditorProps,
  ResolvedTheme,
} from './editor.types'
import { MarkdownSourceEditorAdapter } from './source-editor-adapter'

type ManagedEditorAdapter = OpenMdEditorAdapter | MarkdownSourceEditorAdapter

type MountedEditor =
  | { adapter: OpenMdEditorAdapter; mode: 'visual' }
  | { adapter: MarkdownSourceEditorAdapter; mode: 'source' }

export const OpenMdEditor = forwardRef<OpenMdEditorHandle, OpenMdEditorProps>(function OpenMdEditor(
  {
    initialMarkdown = '',
    initialMode = 'visual',
    readOnly = false,
    onChange,
    onModeChange,
    onSourceCursorChange,
    initialSourceLineNumbers = true,
    initialSourceLineWrapping = true,
    onSourceLineNumbersChange,
    onSourceLineWrappingChange,
    resolvedTheme = 'light',
    documentPath,
    imagesApi,
    onEnsureDocumentSaved,
    onOutlineChange,
    onActiveHeadingChange,
    onSearchStatusChange,
    focusMode = false,
    typewriterMode = false,
    typewriterBehavior = 'input',
    onError,
  },
  forwardedRef,
): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const mountedEditorRef = useRef<MountedEditor | null>(null)
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve())
  const transitionGenerationRef = useRef(0)
  const mountedRef = useRef(false)
  const readOnlyRef = useRef(readOnly)
  const onChangeRef = useRef(onChange)
  const onModeChangeRef = useRef(onModeChange)
  const onSourceCursorChangeRef = useRef(onSourceCursorChange)
  const sourceLineNumbersRef = useRef(initialSourceLineNumbers)
  const sourceLineWrappingRef = useRef(initialSourceLineWrapping)
  const onSourceLineNumbersChangeRef = useRef(onSourceLineNumbersChange)
  const onSourceLineWrappingChangeRef = useRef(onSourceLineWrappingChange)
  const resolvedThemeRef = useRef<ResolvedTheme>(resolvedTheme)
  const imagesApiRef = useRef(imagesApi)
  const documentPathRef = useRef(documentPath)
  const ensureDocumentSavedRef = useRef(onEnsureDocumentSaved)
  const onOutlineChangeRef = useRef(onOutlineChange)
  const onActiveHeadingChangeRef = useRef(onActiveHeadingChange)
  const onSearchStatusChangeRef = useRef(onSearchStatusChange)
  const focusModeRef = useRef(focusMode)
  const typewriterModeRef = useRef(typewriterMode)
  const typewriterBehaviorRef = useRef(typewriterBehavior)
  const onErrorRef = useRef(onError)
  const [mode, setModeState] = useState<EditorMode>(initialMode)
  const [switching, setSwitching] = useState(true)

  onChangeRef.current = onChange
  onModeChangeRef.current = onModeChange
  onSourceCursorChangeRef.current = onSourceCursorChange
  onSourceLineNumbersChangeRef.current = onSourceLineNumbersChange
  onSourceLineWrappingChangeRef.current = onSourceLineWrappingChange
  imagesApiRef.current = imagesApi
  documentPathRef.current = documentPath
  ensureDocumentSavedRef.current = onEnsureDocumentSaved
  onOutlineChangeRef.current = onOutlineChange
  onActiveHeadingChangeRef.current = onActiveHeadingChange
  onSearchStatusChangeRef.current = onSearchStatusChange
  focusModeRef.current = focusMode
  typewriterModeRef.current = typewriterMode
  typewriterBehaviorRef.current = typewriterBehavior
  onErrorRef.current = onError
  resolvedThemeRef.current = resolvedTheme

  const coordinatorRef = useRef<EditorModeCoordinator | null>(null)
  if (!coordinatorRef.current) {
    coordinatorRef.current = new EditorModeCoordinator({
      initialMarkdown,
      initialMode,
      onChange: (markdown) => onChangeRef.current?.(markdown),
    })
  }

  const scheduleEditor = useCallback((targetMode: EditorMode): Promise<void> => {
    const generation = ++transitionGenerationRef.current
    setSwitching(true)

    const operation = lifecycleRef.current.then(async () => {
      if (!mountedRef.current || generation !== transitionGenerationRef.current) return

      const coordinator = coordinatorRef.current!
      const root = rootRef.current
      if (!root) return

      const previous = mountedEditorRef.current
      if (previous?.mode === targetMode) {
        if (coordinator.attach(targetMode, previous.adapter)) {
          previous.adapter.setReadOnly(readOnlyRef.current)
          if (previous.mode === 'visual') {
            previous.adapter.setDocumentPath(documentPathRef.current)
          } else {
            previous.adapter.setLineNumbers(sourceLineNumbersRef.current)
            previous.adapter.setLineWrapping(sourceLineWrappingRef.current)
            previous.adapter.setTheme(resolvedThemeRef.current)
          }
          previous.adapter.setWritingModes(
            focusModeRef.current,
            typewriterModeRef.current,
            typewriterBehaviorRef.current,
          )
          coordinator.markReady(previous.adapter)
          setSwitching(false)
        }
        return
      }

      if (previous) {
        coordinator.detach(previous.adapter)
        mountedEditorRef.current = null
        try {
          await previous.adapter.destroy()
        } finally {
          root.replaceChildren()
        }
      }

      if (!mountedRef.current || generation !== transitionGenerationRef.current) return

      let adapter: ManagedEditorAdapter
      if (targetMode === 'visual') {
        adapter = new OpenMdEditorAdapter({
          root,
          initialMarkdown: coordinator.getSnapshot(),
          readOnly: readOnlyRef.current,
          imagesApi: imagesApiRef.current,
          getDocumentPath: () => documentPathRef.current,
          onEnsureDocumentSaved: async () => ensureDocumentSavedRef.current?.(),
          onOutlineChange: (nextOutline) => {
            if (mountedEditorRef.current?.adapter === adapter) {
              onOutlineChangeRef.current?.([...nextOutline])
            }
          },
          onActiveHeadingChange: (id) => {
            if (mountedEditorRef.current?.adapter === adapter) {
              onActiveHeadingChangeRef.current?.(id)
            }
          },
          onSearchStatusChange: (status) => {
            if (mountedEditorRef.current?.adapter === adapter) {
              onSearchStatusChangeRef.current?.(status)
            }
          },
          focusMode: focusModeRef.current,
          typewriterMode: typewriterModeRef.current,
          typewriterBehavior: typewriterBehaviorRef.current,
          openExternalUrl: (url) => window.openmd.openExternalUrl({ url }),
          onError: (message) => onErrorRef.current?.(message),
          onChange: (markdown) => coordinator.acceptChange(adapter, markdown),
        })
      } else {
        adapter = new MarkdownSourceEditorAdapter({
          root,
          initialMarkdown: coordinator.getSnapshot(),
          readOnly: readOnlyRef.current,
          lineNumbers: sourceLineNumbersRef.current,
          lineWrapping: sourceLineWrappingRef.current,
          theme: resolvedThemeRef.current,
          onChange: (markdown) => coordinator.acceptChange(adapter, markdown),
          onCursorChange: (position) => {
            if (mountedEditorRef.current?.adapter === adapter) {
              onSourceCursorChangeRef.current?.(position)
            }
          },
          onSearchStatusChange: (status) => {
            if (mountedEditorRef.current?.adapter === adapter) {
              onSearchStatusChangeRef.current?.(status)
            }
          },
          focusMode: focusModeRef.current,
          typewriterMode: typewriterModeRef.current,
          typewriterBehavior: typewriterBehaviorRef.current,
        })
      }

      mountedEditorRef.current =
        targetMode === 'visual'
          ? { adapter: adapter as OpenMdEditorAdapter, mode: 'visual' }
          : { adapter: adapter as MarkdownSourceEditorAdapter, mode: 'source' }
      if (!coordinator.attach(targetMode, adapter)) {
        mountedEditorRef.current = null
        try {
          await adapter.destroy()
        } finally {
          root.replaceChildren()
        }
        return
      }

      try {
        await adapter.create()
      } catch (error) {
        coordinator.detach(adapter, false)
        if (mountedEditorRef.current?.adapter === adapter) mountedEditorRef.current = null
        try {
          await adapter.destroy()
        } catch (destroyError) {
          console.error('Failed to clean up an editor that did not initialize:', destroyError)
        }
        root.replaceChildren()
        throw error
      }
      if (
        !mountedRef.current ||
        generation !== transitionGenerationRef.current ||
        coordinator.getMode() !== targetMode
      ) {
        coordinator.detach(adapter, false)
        if (mountedEditorRef.current?.adapter === adapter) mountedEditorRef.current = null
        try {
          await adapter.destroy()
        } finally {
          root.replaceChildren()
        }
        return
      }

      coordinator.markReady(adapter)
      setSwitching(false)
    })

    lifecycleRef.current = operation.catch((error: unknown) => {
      if (generation === transitionGenerationRef.current) setSwitching(false)
      console.error('Failed to switch editor mode:', error)
    })
    return operation
  }, [])

  const setMode = useCallback(
    (nextMode: EditorMode): Promise<void> => {
      const coordinator = coordinatorRef.current!
      if (!coordinator.switchMode(nextMode)) {
        if (coordinator.hasActiveEditor()) {
          coordinator.focus()
          return lifecycleRef.current
        }
        return scheduleEditor(nextMode)
      }

      setModeState(nextMode)
      onModeChangeRef.current?.(nextMode)
      return scheduleEditor(nextMode)
    },
    [scheduleEditor],
  )

  useImperativeHandle(
    forwardedRef,
    () => ({
      getMarkdown: () => coordinatorRef.current!.getMarkdown(),
      setMarkdown: (markdown) => coordinatorRef.current!.setMarkdown(markdown),
      setReadOnly: (nextReadOnly) => {
        readOnlyRef.current = nextReadOnly
        mountedEditorRef.current?.adapter.setReadOnly(nextReadOnly)
      },
      focus: () => coordinatorRef.current!.focus(),
      getCursorAnchor: () => mountedEditorRef.current?.adapter.getCursorAnchor?.(),
      restoreCursorAnchor: (anchor) =>
        mountedEditorRef.current?.adapter.restoreCursorAnchor?.(anchor),
      insertImageFromPicker: async () => {
        const mountedEditor = mountedEditorRef.current
        if (mountedEditor?.mode === 'visual') await mountedEditor.adapter.insertImageFromPicker()
      },
      getMode: () => coordinatorRef.current!.getMode(),
      setMode,
      toggleMode: () =>
        setMode(coordinatorRef.current!.getMode() === 'visual' ? 'source' : 'visual'),
      toggleSourceLineNumbers: () => {
        const visible = !sourceLineNumbersRef.current
        sourceLineNumbersRef.current = visible
        const mountedEditor = mountedEditorRef.current
        if (mountedEditor?.mode === 'source') mountedEditor.adapter.setLineNumbers(visible)
        onSourceLineNumbersChangeRef.current?.(visible)
      },
      toggleSourceLineWrapping: () => {
        const enabled = !sourceLineWrappingRef.current
        sourceLineWrappingRef.current = enabled
        const mountedEditor = mountedEditorRef.current
        if (mountedEditor?.mode === 'source') mountedEditor.adapter.setLineWrapping(enabled)
        onSourceLineWrappingChangeRef.current?.(enabled)
      },
      setSearchQuery: (query) => mountedEditorRef.current?.adapter.setSearchQuery?.(query),
      findNext: (direction = 1) => mountedEditorRef.current?.adapter.findNext?.(direction),
      replaceCurrent: () => mountedEditorRef.current?.adapter.replaceCurrent?.(),
      replaceAll: () => mountedEditorRef.current?.adapter.replaceAll?.(),
      clearSearch: () => mountedEditorRef.current?.adapter.clearSearch?.(),
      setWritingModes: (nextFocusMode, nextTypewriterMode, behavior) => {
        focusModeRef.current = nextFocusMode
        typewriterModeRef.current = nextTypewriterMode
        typewriterBehaviorRef.current = behavior
        mountedEditorRef.current?.adapter.setWritingModes?.(
          nextFocusMode,
          nextTypewriterMode,
          behavior,
        )
      },
      getScrollPosition: () => {
        const mountedEditor = mountedEditorRef.current
        if (mountedEditor?.mode === 'source') {
          return rootRef.current?.querySelector<HTMLElement>('.cm-scroller')?.scrollTop ?? 0
        }
        return scrollContainerRef.current?.scrollTop ?? 0
      },
      setScrollPosition: (position) => {
        const applyPosition = (): void => {
          const mountedEditor = mountedEditorRef.current
          const scrollElement =
            mountedEditor?.mode === 'source'
              ? rootRef.current?.querySelector<HTMLElement>('.cm-scroller')
              : scrollContainerRef.current
          if (scrollElement) scrollElement.scrollTop = Math.max(0, position)
        }
        applyPosition()
        requestAnimationFrame(applyPosition)
      },
      revealLine: (line) => {
        const markdown = coordinatorRef.current!.getMarkdown()
        const targetLine = Math.max(1, Math.trunc(line))
        let offset = 0
        for (
          let currentLine = 1;
          currentLine < targetLine && offset < markdown.length;
          currentLine += 1
        ) {
          const match = markdown.slice(offset).match(/\r\n|\r|\n/)
          if (!match || match.index === undefined) {
            offset = markdown.length
            break
          }
          offset += match.index + match[0].length
        }
        mountedEditorRef.current?.adapter.restoreCursorAnchor?.({ offset })
        mountedEditorRef.current?.adapter.focus()
      },
      scrollToHeading: (id) => {
        const mountedEditor = mountedEditorRef.current
        return mountedEditor?.mode === 'visual' ? mountedEditor.adapter.scrollToHeading(id) : false
      },
      whenIdle: async () => {
        await lifecycleRef.current
        await mountedEditorRef.current?.adapter.whenStable()
      },
    }),
    [setMode],
  )

  useEffect(() => {
    mountedRef.current = true
    const root = rootRef.current
    void scheduleEditor(coordinatorRef.current!.getMode())

    return () => {
      mountedRef.current = false
      transitionGenerationRef.current += 1
      const previous = mountedEditorRef.current
      if (previous) coordinatorRef.current?.detach(previous.adapter)
      mountedEditorRef.current = null
      lifecycleRef.current = lifecycleRef.current.then(async () => {
        try {
          if (previous) await previous.adapter.destroy()
        } finally {
          root?.replaceChildren()
        }
      })
    }
  }, [scheduleEditor])

  useEffect(() => {
    readOnlyRef.current = readOnly
    mountedEditorRef.current?.adapter.setReadOnly(readOnly)
  }, [readOnly])

  useEffect(() => {
    const mountedEditor = mountedEditorRef.current
    if (mountedEditor?.mode === 'visual') mountedEditor.adapter.setDocumentPath(documentPath)
  }, [documentPath])

  useEffect(() => {
    const mountedEditor = mountedEditorRef.current
    if (mountedEditor?.mode === 'source') mountedEditor.adapter.setTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    mountedEditorRef.current?.adapter.setWritingModes?.(
      focusMode,
      typewriterMode,
      typewriterBehavior,
    )
  }, [focusMode, typewriterBehavior, typewriterMode])

  return (
    <div className="openmd-editor-layout" data-mode={mode} data-switching={switching}>
      <div
        ref={scrollContainerRef}
        className={mode === 'visual' ? 'openmd-editor-scroll' : 'openmd-source-editor-scroll'}
      >
        <div
          ref={rootRef}
          className={mode === 'visual' ? 'openmd-editor' : 'openmd-source-editor'}
          aria-label={mode === 'visual' ? 'Markdown 正文编辑器' : 'Markdown 源码编辑器'}
        />
      </div>
    </div>
  )
})
