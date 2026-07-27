// @vitest-environment jsdom

import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, it } from 'vitest'

import { createWritingModesFeature } from '../src/renderer/src/editor/writing-modes-feature'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
})

let view: EditorView | undefined

afterEach(() => {
  view?.destroy()
  view = undefined
  document.body.replaceChildren()
})

describe('writing mode ProseMirror feature', () => {
  it('decorates only the selected block without changing document content', () => {
    const feature = createWritingModesFeature({
      focusMode: true,
      typewriterMode: false,
      typewriterBehavior: 'input',
    })
    const documentNode = schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('第一段')),
      schema.node('paragraph', null, schema.text('第二段')),
    ])
    const root = document.createElement('div')
    document.body.append(root)
    view = new EditorView(root, {
      state: EditorState.create({
        doc: documentNode,
        plugins: [feature.proseMirrorPlugin],
      }),
    })

    expect(root.querySelector('.openmd-focus-block')?.textContent).toBe('第一段')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)))
    expect(root.querySelector('.openmd-focus-block')?.textContent).toBe('第二段')
    expect(view.state.doc.toJSON()).toEqual(documentNode.toJSON())
  })
})
