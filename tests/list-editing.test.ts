import { Schema } from '@milkdown/prose/model'
import type { Node as ProseMirrorNode, NodeType } from '@milkdown/prose/model'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'

import {
  continueTaskListItem,
  indentListItem,
  outdentListItem,
} from '../src/renderer/src/editor/list-editing-plugin'
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    bullet_list: { content: 'list_item+', group: 'block' },
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { order: { default: 1 } },
    },
    list_item: {
      content: 'paragraph block*',
      attrs: {
        label: { default: '•' },
        listType: { default: 'bullet' },
        spread: { default: true },
        checked: { default: null },
      },
    },
  },
})

const paragraphType = schema.nodes.paragraph as NodeType
const bulletListType = schema.nodes.bullet_list as NodeType
const listItemType = schema.nodes.list_item as NodeType

function paragraph(text = ''): ProseMirrorNode {
  return paragraphType.create(null, text ? schema.text(text) : undefined)
}

function listItem(text: string, checked: boolean | null = null): ProseMirrorNode {
  return listItemType.create({ checked }, paragraph(text))
}

function stateAtText(document: ProseMirrorNode, text: string): EditorState {
  let position = -1
  document.descendants((node, offset) => {
    if (position < 0 && node.isText && node.text === text) position = offset + node.nodeSize
  })
  if (position < 0) throw new Error(`Text not found: ${text}`)

  return EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, position),
  })
}

function stateAtEmptyParagraph(document: ProseMirrorNode): EditorState {
  let position = -1
  document.descendants((node, offset) => {
    if (position < 0 && node.type === paragraphType && node.content.size === 0) {
      position = offset + 1
    }
  })
  if (position < 0) throw new Error('Empty paragraph not found')

  return EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, position),
  })
}

function applyCommand(state: EditorState, command: ReturnType<typeof indentListItem>): EditorState {
  let nextState: EditorState | undefined
  const handled = command(state, (transaction) => {
    nextState = state.apply(transaction)
  })
  expect(handled).toBe(true)
  if (!nextState) throw new Error('Command did not dispatch a transaction')
  return nextState
}

describe('list editing commands', () => {
  it('indents and outdents the current list item by one level', () => {
    const document = schema.nodes.doc.create(
      null,
      bulletListType.create(null, [listItem('first'), listItem('second')]),
    )
    const initialState = stateAtText(document, 'second')

    const indentedState = applyCommand(initialState, indentListItem(listItemType))
    const outerList = indentedState.doc.firstChild
    expect(outerList?.childCount).toBe(1)
    expect(outerList?.firstChild?.lastChild?.type).toBe(bulletListType)
    expect(outerList?.firstChild?.lastChild?.firstChild?.textContent).toBe('second')

    const restoredState = applyCommand(indentedState, outdentListItem(listItemType))
    expect(restoredState.doc.firstChild?.childCount).toBe(2)
    expect(restoredState.doc.firstChild?.child(1).textContent).toBe('second')
  })

  it('continues a completed task as a new unchecked task', () => {
    const document = schema.nodes.doc.create(
      null,
      bulletListType.create(null, listItem('done', true)),
    )
    const initialState = stateAtText(document, 'done')
    const nextState = applyCommand(initialState, continueTaskListItem(listItemType))

    const taskList = nextState.doc.firstChild
    expect(taskList?.childCount).toBe(2)
    expect(taskList?.child(0).attrs.checked).toBe(true)
    expect(taskList?.child(1).attrs.checked).toBe(false)
  })

  it('lifts an empty task item out of its list', () => {
    const document = schema.nodes.doc.create(null, bulletListType.create(null, listItem('', false)))
    const initialState = stateAtEmptyParagraph(document)
    const nextState = applyCommand(initialState, continueTaskListItem(listItemType))

    expect(nextState.doc.childCount).toBe(1)
    expect(nextState.doc.firstChild?.type).toBe(paragraphType)
  })

  it('does not consume Enter in an ordinary list item', () => {
    const document = schema.nodes.doc.create(null, bulletListType.create(null, listItem('plain')))
    const state = stateAtText(document, 'plain')

    expect(continueTaskListItem(listItemType)(state)).toBe(false)
  })
})
