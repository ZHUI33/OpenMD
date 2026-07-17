// @vitest-environment jsdom

import { EditorView } from '@codemirror/view'
import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { OpenMdEditor } from '../src/renderer/src/editor/OpenMdEditor'
import type { EditorMode, OpenMdEditorHandle } from '../src/renderer/src/editor/editor.types'

class ImmediateIntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe = (target: Element): void => {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: performance.now(),
        },
      ],
      this as unknown as IntersectionObserver,
    )
  }

  disconnect = (): void => undefined
  takeRecords = (): IntersectionObserverEntry[] => []
  unobserve = (): void => undefined
}

class NoopResizeObserver {
  disconnect = (): void => undefined
  observe = (): void => undefined
  unobserve = (): void => undefined
}

const mountedRoots: Root[] = []

beforeAll(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: ImmediateIntersectionObserver,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: NoopResizeObserver,
  })
  if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    })
  }
  if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(),
    })
  }
})

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount()
    await Promise.resolve()
  })
  document.body.replaceChildren()
})

async function mountEditor(
  initialMarkdown: string,
  initialMode: EditorMode = 'visual',
): Promise<{
  container: HTMLDivElement
  handle: OpenMdEditorHandle
  changes: string[]
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const ref = createRef<OpenMdEditorHandle>()
  const changes: string[] = []
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      createElement(OpenMdEditor, {
        ref,
        initialMarkdown,
        initialMode,
        onChange: (markdown: string) => changes.push(markdown),
      }),
    )
    await Promise.resolve()
  })
  await vi.waitFor(() => expect(ref.current).not.toBeNull())
  await act(async () => ref.current!.whenIdle())

  return { container, handle: ref.current!, changes }
}

describe('editor mode host integration', () => {
  it('switches an empty document without substituting fallback content', async () => {
    const { handle } = await mountEditor('')

    await act(async () => handle.setMode('source'))
    expect(handle.getMarkdown()).toBe('')
    await act(async () => handle.setMode('visual'))

    expect(handle.getMarkdown()).toBe('')
  })

  it('shows exactly one editor and round-trips source edits through visual mode', async () => {
    const { container, handle, changes } = await mountEditor('# 初始')

    expect(container.querySelector('.milkdown')).not.toBeNull()
    expect(container.querySelector('.openmd-source-editor .cm-editor')).toBeNull()

    await act(async () => handle.toggleMode())
    expect(handle.getMode()).toBe('source')
    expect(container.querySelector('.milkdown')).toBeNull()
    const sourceElement = container.querySelector<HTMLElement>('.openmd-source-editor .cm-editor')
    expect(sourceElement).not.toBeNull()

    const view = EditorView.findFromDOM(sourceElement!)
    const sourceMarkdown = [
      '# 中文源码',
      '',
      '| 项目 | 状态 |',
      '| --- | --- |',
      '| OpenMD | 阶段 7 |',
      '',
      '$$E=mc^2$$',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '',
      '![图片](./assets/demo.png)  ',
    ].join('\n')
    await act(async () => {
      view!.dispatch({
        changes: { from: 0, to: view!.state.doc.length, insert: sourceMarkdown },
      })
    })
    expect(handle.getMarkdown()).toBe(sourceMarkdown)
    expect(changes.at(-1)).toBe(sourceMarkdown)

    await act(async () => handle.toggleMode())
    expect(handle.getMode()).toBe('visual')
    expect(container.querySelector('.milkdown')).not.toBeNull()
    expect(container.querySelector('.openmd-source-editor .cm-editor')).toBeNull()
    expect(handle.getMarkdown()).toBe(sourceMarkdown)

    await act(async () => handle.toggleMode())
    expect(handle.getMarkdown()).toBe(sourceMarkdown)
  })

  it('settles rapid visual/source requests on one final source instance', async () => {
    const { container, handle } = await mountEditor('快速切换内容')

    await act(async () => {
      await Promise.all([
        handle.setMode('source'),
        handle.setMode('visual'),
        handle.setMode('source'),
      ])
    })

    expect(handle.getMode()).toBe('source')
    expect(container.querySelectorAll('.openmd-source-editor .cm-editor')).toHaveLength(1)
    expect(container.querySelector('.milkdown')).toBeNull()
    expect(handle.getMarkdown()).toBe('快速切换内容')
  })

  it.each([
    ['table only', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['list only', '- one\n- two'],
    ['fenced code only', '```ts\nconst value = 1\n```'],
  ])('does not normalize untouched %s Markdown through visual mode', async (_name, markdown) => {
    const { handle, changes } = await mountEditor(markdown, 'source')

    await act(async () => handle.setMode('visual'))
    expect(handle.getMarkdown()).toBe(markdown)
    await act(async () => handle.setMode('source'))

    expect(handle.getMarkdown()).toBe(markdown)
    expect(changes).toEqual([])
  })

  it('restores the same paragraph block instead of jumping to its heading', async () => {
    const markdown = '# 章节\n\n第一段\n\n目标段落'
    const { container, handle } = await mountEditor(markdown, 'source')
    const sourceElement = container.querySelector<HTMLElement>('.openmd-source-editor .cm-editor')
    const sourceView = EditorView.findFromDOM(sourceElement!)
    sourceView!.dispatch({ selection: { anchor: sourceView!.state.doc.line(5).from + 2 } })

    await act(async () => handle.setMode('visual'))
    await act(async () => handle.setMode('source'))

    const restoredElement = container.querySelector<HTMLElement>('.openmd-source-editor .cm-editor')
    const restoredView = EditorView.findFromDOM(restoredElement!)
    expect(restoredView!.state.doc.lineAt(restoredView!.state.selection.main.head).number).toBe(5)
  })

  it('keeps an opened block-only document exact after visual plugins settle', async () => {
    const { handle, changes } = await mountEditor('old visual document')
    const openedMarkdown = '| a | b |\n| --- | --- |\n| 1 | 2 |'

    act(() => handle.setMarkdown(openedMarkdown))
    expect(handle.getMarkdown()).toBe(openedMarkdown)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 120)))

    expect(handle.getMarkdown()).toBe(openedMarkdown)
    expect(changes).toEqual([])
  })
})
