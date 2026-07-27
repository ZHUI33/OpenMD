// @vitest-environment jsdom

import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { describe, expect, it } from 'vitest'

import {
  clearFormatting,
  isExternalLink,
  normalizeEditableLink,
  toggleFormattingMark,
} from '../src/renderer/src/editor/formatting-feature'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
  marks: {
    strong: {},
    emphasis: {},
    strike_through: {},
    inlineCode: {},
    link: { attrs: { href: {} } },
  },
})

function createView(text: string): { view: EditorView; getState: () => EditorState } {
  const documentNode = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))])
  let state = EditorState.create({
    doc: documentNode,
    selection: TextSelection.create(documentNode, 1, text.length + 1),
  })
  const view = {
    get state() {
      return state
    },
    dispatch(transaction: Transaction) {
      state = state.apply(transaction)
    },
  } as unknown as EditorView
  return { view, getState: () => state }
}

describe('visual formatting commands', () => {
  it('toggles bold, italic, strikethrough, and inline code marks', () => {
    for (const command of ['strong', 'emphasis', 'strike_through', 'inlineCode'] as const) {
      const { view, getState } = createView('OpenMD')
      expect(toggleFormattingMark(view, command)).toBe(true)
      expect(getState().doc.rangeHasMark(1, 7, schema.marks[command]!)).toBe(true)
    }
  })

  it('clears all inline formatting without inserting private nodes', () => {
    const { view, getState } = createView('纯文本')
    toggleFormattingMark(view, 'strong')
    toggleFormattingMark(view, 'emphasis')
    expect(clearFormatting(view)).toBe(true)
    expect(getState().doc.textContent).toBe('纯文本')
    expect(getState().doc.rangeHasMark(1, 4, schema.marks.strong!)).toBe(false)
    expect(getState().doc.toJSON()).not.toHaveProperty('openmd')
  })

  it('accepts Markdown-relative links but only externally opens safe protocols', () => {
    expect(normalizeEditableLink('../guide.md#intro')).toBe('../guide.md#intro')
    expect(normalizeEditableLink('javascript:alert(1)')).toBeUndefined()
    expect(isExternalLink('https://example.com')).toBe(true)
    expect(isExternalLink('mailto:writer@example.com')).toBe(true)
    expect(isExternalLink('../guide.md')).toBe(false)
  })
})
