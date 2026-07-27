// @vitest-environment jsdom

import { Schema } from '@milkdown/kit/prose/model'
import { history, undo } from '@milkdown/kit/prose/history'
import { EditorState } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDocumentSearchFeature,
  findDocumentSearchMatches,
} from '../src/renderer/src/editor/search-feature'
import type { DocumentSearchQuery } from '../src/renderer/src/editor/editor.types'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    image: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { src: {} },
      toDOM: (node) => ['img', { src: node.attrs.src }],
    },
    math_inline: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { value: {} },
      toDOM: (node) => ['span', { 'data-math': node.attrs.value }],
    },
  },
  marks: {
    link: {
      attrs: { href: {} },
      toDOM: (mark) => ['a', { href: mark.attrs.href }, 0],
    },
  },
})

const baseQuery: DocumentSearchQuery = {
  query: 'alpha',
  replacement: 'Beta',
  caseSensitive: false,
  wholeWord: true,
  regularExpression: false,
}

const views: EditorView[] = []

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

function createDocument() {
  const link = schema.marks.link!.create({ href: 'https://example.com' })
  return schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Alpha '),
      schema.text('alpha', [link]),
      schema.node('image', { src: './cover.png' }),
      schema.text(' alpha'),
      schema.node('math_inline', { value: 'x^2' }),
    ]),
    schema.node('paragraph', null, schema.text('alphabet ALPHA')),
  ])
}

describe('visual document search', () => {
  it('supports case, whole-word and regular-expression matching across marked text', () => {
    const documentNode = createDocument()
    expect(findDocumentSearchMatches(documentNode, baseQuery).matches).toHaveLength(4)
    expect(
      findDocumentSearchMatches(documentNode, {
        ...baseQuery,
        query: '^Alpha',
        regularExpression: true,
        caseSensitive: true,
      }).matches,
    ).toHaveLength(1)
    expect(
      findDocumentSearchMatches(documentNode, {
        ...baseQuery,
        query: '(',
        regularExpression: true,
      }).error,
    ).toBeDefined()
  })

  it('uses ProseMirror transactions/decorations and refreshes links, images and formulas', () => {
    const statusListener = vi.fn()
    const feature = createDocumentSearchFeature(statusListener)
    const root = document.createElement('div')
    document.body.append(root)
    const view = new EditorView(root, {
      state: EditorState.create({
        doc: createDocument(),
        plugins: [history(), feature.proseMirrorPlugin],
      }),
    })
    views.push(view)

    feature.controller.setQuery(baseQuery)
    expect(root.querySelectorAll('.openmd-search-match')).toHaveLength(4)
    expect(statusListener).toHaveBeenLastCalledWith({ current: 1, total: 4 })

    feature.controller.next(1)
    expect(statusListener).toHaveBeenLastCalledWith({ current: 2, total: 4 })
    feature.controller.replaceCurrent()
    expect(view.state.doc.textContent).toContain('Alpha Beta')
    expect(view.state.doc.rangeHasMark(7, 11, schema.marks.link!)).toBe(true)
    expect(view.state.doc.toJSON()).toMatchObject({
      content: [
        {
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'image', attrs: { src: './cover.png' } }),
            expect.objectContaining({ type: 'math_inline', attrs: { value: 'x^2' } }),
          ]),
        },
        expect.anything(),
      ],
    })

    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.textContent).toContain('Alpha alpha')
  })
})
