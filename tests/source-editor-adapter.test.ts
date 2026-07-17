// @vitest-environment jsdom

import { redo, undo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { MarkdownSourceEditorAdapter } from '../src/renderer/src/editor/source-editor-adapter'
import type { SourceCursorPosition } from '../src/renderer/src/editor/editor.types'

class NoopResizeObserver {
  disconnect = (): void => undefined
  observe = (): void => undefined
  unobserve = (): void => undefined
}

const adapters: MarkdownSourceEditorAdapter[] = []

beforeAll(() => {
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
  await Promise.all(adapters.splice(0).map((adapter) => adapter.destroy()))
  document.body.replaceChildren()
})

async function createAdapter(
  markdown: string,
  options: {
    onChange?: (markdown: string) => void
    onCursorChange?: (position: SourceCursorPosition) => void
  } = {},
): Promise<{
  adapter: MarkdownSourceEditorAdapter
  root: HTMLDivElement
  view: EditorView
}> {
  const root = document.createElement('div')
  document.body.append(root)
  const adapter = new MarkdownSourceEditorAdapter({
    root,
    initialMarkdown: markdown,
    readOnly: false,
    lineNumbers: true,
    lineWrapping: true,
    theme: 'light',
    onChange: options.onChange ?? (() => undefined),
    onCursorChange: options.onCursorChange,
  })
  adapters.push(adapter)
  await adapter.create()
  const editorElement = root.querySelector<HTMLElement>('.cm-editor')
  if (!editorElement) throw new Error('CodeMirror did not mount.')
  const view = EditorView.findFromDOM(editorElement)
  if (!view) throw new Error('CodeMirror view was not found.')
  return { adapter, root, view }
}

describe('Markdown source editor adapter', () => {
  it('preserves the exact untouched Markdown string, including CRLF and trailing whitespace', async () => {
    const markdown = '# 标题\r\n\r\n正文尾随空格  \r\n'
    const { adapter } = await createAdapter(markdown)

    expect(adapter.getMarkdown()).toBe(markdown)
  })

  it('recognizes pasted LF and CRLF as real lines regardless of the saved line ending', async () => {
    const { adapter, view } = await createAdapter('a\r\nb')

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x\ny' } })
    expect(view.state.doc.lines).toBe(2)
    expect(adapter.getMarkdown()).toBe('x\r\ny')

    adapter.setMarkdown('a\nb')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x\r\ny' } })
    expect(view.state.doc.lines).toBe(2)
    expect(view.state.doc.line(1).text).toBe('x')
    expect(adapter.getMarkdown()).toBe('x\ny')
  })

  it('parses mixed line endings while preserving the untouched raw snapshot', async () => {
    const markdown = 'one\r\ntwo\nthree\rfour'
    const { adapter, view } = await createAdapter(markdown)

    expect(view.state.doc.lines).toBe(4)
    expect(adapter.getMarkdown()).toBe(markdown)
  })

  it('preserves mixed line endings through edits, undo, and redo', async () => {
    const markdown = 'one\r\ntwo\nthree\rfour'
    const onChange = vi.fn()
    const { adapter, view } = await createAdapter(markdown, { onChange })

    view.dispatch({ changes: { from: 3, insert: ' edited' } })
    const editedMarkdown = 'one edited\r\ntwo\nthree\rfour'
    expect(adapter.getMarkdown()).toBe(editedMarkdown)
    expect(onChange).toHaveBeenLastCalledWith(editedMarkdown)

    expect(undo(view)).toBe(true)
    expect(adapter.getMarkdown()).toBe(markdown)
    expect(redo(view)).toBe(true)
    expect(adapter.getMarkdown()).toBe(editedMarkdown)
  })

  it('restores mixed line endings after a long grouped typing history', async () => {
    const markdown = 'one\r\ntwo\nthree\rfour'
    const { adapter, view } = await createAdapter(markdown)

    for (let index = 0; index < 250; index += 1) {
      view.dispatch({
        changes: { from: 3 + index, insert: 'x' },
        userEvent: 'input.type',
      })
    }

    expect(undo(view)).toBe(true)
    expect(adapter.getMarkdown()).toBe(markdown)
    expect(redo(view)).toBe(true)
    expect(adapter.getMarkdown()).toBe(`one${'x'.repeat(250)}\r\ntwo\nthree\rfour`)
  })

  it('keeps logical line breaks distinct when edits join lone CR and LF fragments', async () => {
    const { adapter, view } = await createAdapter('a\rX\nb')

    view.dispatch({ changes: { from: 2, to: 3 } })

    expect(view.state.doc.toString()).toBe('a\n\nb')
    expect(adapter.getMarkdown().replace(/\r\n|\r/g, '\n')).toBe(view.state.doc.toString())
    expect(adapter.getMarkdown()).toBe('a\r\r\nb')
  })

  it('keeps inserted newlines distinct from a preceding lone CR', async () => {
    const { adapter, view } = await createAdapter('a\nb\rc')

    view.dispatch({ changes: { from: 4, insert: '\n' } })

    expect(view.state.doc.toString()).toBe('a\nb\n\nc')
    expect(adapter.getMarkdown().replace(/\r\n|\r/g, '\n')).toBe(view.state.doc.toString())
    expect(adapter.getMarkdown()).toBe('a\nb\r\r\nc')
  })

  it('replaces LF and CRLF documents without onChange loops', async () => {
    const onChange = vi.fn()
    const { adapter } = await createAdapter('first\nfile', { onChange })

    const crlf = '第二个\r\n文档\r\n'
    adapter.setMarkdown(crlf)
    expect(adapter.getMarkdown()).toBe(crlf)
    adapter.setMarkdown('third\nfile\n')
    expect(adapter.getMarkdown()).toBe('third\nfile\n')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('emits exact user edits and supports undo and redo', async () => {
    const onChange = vi.fn()
    const { adapter, view } = await createAdapter('中文', { onChange })

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' Markdown  ' } })
    expect(adapter.getMarkdown()).toBe('中文 Markdown  ')
    expect(onChange).toHaveBeenLastCalledWith('中文 Markdown  ')

    expect(undo(view)).toBe(true)
    expect(adapter.getMarkdown()).toBe('中文')
    expect(redo(view)).toBe(true)
    expect(adapter.getMarkdown()).toBe('中文 Markdown  ')
  })

  it('clears the previous document history on setMarkdown', async () => {
    const { adapter, view } = await createAdapter('old file')
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' edited' } })

    adapter.setMarkdown('new file')

    expect(undo(view)).toBe(false)
    expect(adapter.getMarkdown()).toBe('new file')
  })

  it('clears history when a replacement document has identical content', async () => {
    const { adapter, view } = await createAdapter('same')
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' content' } })
    const replacement = adapter.getMarkdown()

    adapter.setMarkdown(replacement)

    expect(undo(view)).toBe(false)
    expect(adapter.getMarkdown()).toBe('same content')
  })

  it('provides line numbers, folding, wrapping, search/replace UI, and dark theme switching', async () => {
    const { adapter, root, view } = await createAdapter('# Heading\n\nlong line')

    expect(root.querySelector('.cm-lineNumbers')).not.toBeNull()
    expect(root.querySelector('.cm-foldGutter')).not.toBeNull()
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(true)
    expect(openSearchPanel(view)).toBe(true)
    expect(root.querySelector('.cm-search')).not.toBeNull()
    expect(root.querySelector<HTMLInputElement>('[name="replace"]')).not.toBeNull()

    adapter.setLineNumbers(false)
    adapter.setLineWrapping(false)
    adapter.setTheme('dark')

    expect(root.querySelector('.cm-lineNumbers')).toBeNull()
    expect(view.contentDOM.classList.contains('cm-lineWrapping')).toBe(false)
    expect(view.state.facet(EditorView.darkTheme)).toBe(true)
  })

  it('reports Unicode-aware one-based line and column positions', async () => {
    const positions: SourceCursorPosition[] = []
    const { view } = await createAdapter('first\n中🚀', {
      onCursorChange: (position) => positions.push(position),
    })

    view.dispatch({ selection: { anchor: view.state.doc.length } })

    expect(positions.at(-1)).toEqual({ line: 2, column: 3 })
  })

  it('restores source offsets across CRLF documents near the same paragraph', async () => {
    const markdown = '# 标题\r\n\r\n第一段\r\n\r\n第二段'
    const { adapter, view } = await createAdapter(markdown)
    const offset = markdown.indexOf('第二段') + 2

    adapter.restoreCursorAnchor({ offset })

    expect(adapter.getCursorAnchor()?.offset).toBe(offset)
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
  })

  it('uses block proximity to disambiguate repeated heading anchors', async () => {
    const markdown = '# 重复\n\n第一段\n\n# 重复\n\n第二段'
    const { adapter, view } = await createAdapter(markdown)

    adapter.restoreCursorAnchor({ headingText: '重复', blockIndex: 2 })

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
  })

  it('prefers the paragraph block over its preceding heading', async () => {
    const markdown = '# 章节\n\n第一段\n\n目标段落'
    const { adapter, view } = await createAdapter(markdown)

    adapter.restoreCursorAnchor({ headingText: '章节', blockIndex: 2 })

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)
  })
})
