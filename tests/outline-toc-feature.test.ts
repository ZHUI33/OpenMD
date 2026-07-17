// @vitest-environment jsdom

import { defaultValueCtx, Editor, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { Schema } from '@milkdown/kit/prose/model'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDocumentOutline,
  buildOutlineTree,
  createOutlineFeature,
  findActiveHeadingId,
  flattenOutline,
} from '../src/renderer/src/editor/outline-feature'
import {
  createDocumentOutlineFeature,
  isTocParagraph,
  TOC_MARKER,
} from '../src/renderer/src/editor/toc-feature'

const schema = new Schema({
  nodes: {
    doc: { content: 'block*' },
    paragraph: { content: 'text*', group: 'block' },
    heading: {
      attrs: { level: { default: 1 } },
      content: 'text*',
      group: 'block',
      toDOM: (node) => [`h${node.attrs.level}`, 0],
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
    },
    text: { group: 'inline' },
  },
})

function documentWithHeadings(
  headings: ReadonlyArray<readonly [level: number, text: string]>,
): ProseMirrorNode {
  return schema.node(
    'doc',
    null,
    headings.map(([level, text]) =>
      schema.node('heading', { level }, text ? schema.text(text) : undefined),
    ),
  )
}

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('document outline model', () => {
  it('builds an H1-H6 tree with source positions', () => {
    const documentNode = documentWithHeadings([
      [1, '一级'],
      [2, '二级'],
      [3, '三级'],
      [4, '四级'],
      [5, '五级'],
      [6, '六级'],
      [2, '第二节'],
    ])

    const outline = buildDocumentOutline(documentNode)

    expect(outline).toHaveLength(1)
    expect(outline[0]?.text).toBe('一级')
    expect(outline[0]?.children[0]?.text).toBe('二级')
    expect(outline[0]?.children[0]?.children[0]?.text).toBe('三级')
    expect(outline[0]?.children[0]?.children[0]?.children[0]?.text).toBe('四级')
    expect(outline[0]?.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.text).toBe(
      '六级',
    )
    expect(outline[0]?.children[1]?.text).toBe('第二节')
    expect(flattenOutline(outline).map(({ position }) => position)).toEqual([
      0, 4, 8, 12, 16, 20, 24,
    ])
  })

  it('creates deterministic unique IDs for duplicate and empty headings', () => {
    const outline = buildOutlineTree([
      { level: 1, text: '重复标题', position: 0 },
      { level: 2, text: '重复标题', position: 5 },
      { level: 2, text: '重复标题', position: 10 },
      { level: 2, text: '', position: 15 },
      { level: 2, text: '', position: 20 },
    ])

    expect(flattenOutline(outline).map(({ id }) => id)).toEqual([
      '重复标题',
      '重复标题-2',
      '重复标题-3',
      'section',
      'section-2',
    ])
  })

  it('preserves IDs across title edits and downstream position shifts', () => {
    const previous = buildOutlineTree([
      { level: 1, text: '原标题', position: 0 },
      { level: 2, text: '保持不变', position: 5 },
    ])
    const rebuilt = buildOutlineTree(
      [
        { level: 1, text: '编辑后的标题', position: 0 },
        { level: 2, text: '保持不变', position: 12 },
      ],
      previous,
    )

    expect(flattenOutline(rebuilt).map(({ id }) => id)).toEqual(
      flattenOutline(previous).map(({ id }) => id),
    )
  })

  it('finds the current heading from a document position', () => {
    const outline = buildOutlineTree([
      { level: 1, text: '开始', position: 2 },
      { level: 2, text: '细节', position: 20 },
      { level: 1, text: '结束', position: 40 },
    ])

    expect(findActiveHeadingId(outline, 0)).toBeNull()
    expect(findActiveHeadingId(outline, 2)).toBe('开始')
    expect(findActiveHeadingId(outline, 39)).toBe('细节')
    expect(findActiveHeadingId(outline, 99)).toBe('结束')
  })
})

describe('outline synchronization', () => {
  it('debounces document rebuilds and keeps scroll lookup available', () => {
    vi.useFakeTimers()
    const feature = createOutlineFeature({ debounceMs: 60 })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const state = EditorState.create({
      doc: documentWithHeadings([[1, 'A']]),
      plugins: [feature.proseMirrorPlugin],
    })
    const holder: { view?: EditorView } = {}
    const view = new EditorView(root, {
      state,
      dispatchTransaction: (transaction) => {
        const currentView = holder.view
        if (currentView) currentView.updateState(currentView.state.apply(transaction))
      },
    })
    holder.view = view
    const updates = vi.fn()
    feature.controller.subscribe(updates, false)

    view.dispatch(view.state.tr.insertText('B', 2))
    view.dispatch(view.state.tr.insertText('C', 3))
    vi.advanceTimersByTime(59)
    expect(updates).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(updates).toHaveBeenCalledOnce()
    expect(feature.controller.getOutline()[0]?.text).toBe('ABC')
    expect(feature.controller.scrollToHeading('a', { focus: false, behavior: 'auto' })).toBe(true)

    view.dispatch(view.state.tr.insertText('D', 4))
    view.destroy()
    vi.runAllTimers()
    expect(updates).toHaveBeenCalledTimes(2)
    expect(updates).toHaveBeenLastCalledWith([])
  })
})

describe('dynamic Markdown TOC', () => {
  it('recognizes only a plain, exact [TOC] paragraph', () => {
    const marker = schema.node('paragraph', null, schema.text(TOC_MARKER))
    const wrongCase = schema.node('paragraph', null, schema.text('[toc]'))
    const surroundingText = schema.node('paragraph', null, schema.text(`前缀 ${TOC_MARKER}`))

    expect(isTocParagraph(marker)).toBe(true)
    expect(isTocParagraph(wrongCase)).toBe(false)
    expect(isTocParagraph(surroundingText)).toBe(false)
  })

  it('renders a live TOC while round-tripping the literal marker', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const source = ['[TOC]', '', '# 重复', '', '## 子标题', '', '# 重复'].join('\n')
    const feature = createDocumentOutlineFeature({ debounceMs: 20 })
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, source)
      })
      .config(feature.configure)
      .use(commonmark)
      .use(feature.plugins)

    await editor.create()
    const parse = editor.action((ctx) => ctx.get(parserCtx))
    const serialize = editor.action((ctx) => ctx.get(serializerCtx))
    const opened = parse(source)

    await vi.waitFor(() => {
      expect(root.querySelector('.openmd-toc')).not.toBeNull()
    })
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.openmd-toc-link')]
    expect(links.map((link) => link.textContent)).toEqual(['重复', '子标题', '重复'])
    expect(new Set(links.map((link) => link.dataset.outlineId)).size).toBe(3)

    const saved = serialize(opened)
    expect(saved.split('\n')[0]).toBe(TOC_MARKER)
    expect(saved).not.toContain('openmd-toc')
    expect(serialize(parse(saved))).toBe(saved)
    await editor.destroy()
  })
})
