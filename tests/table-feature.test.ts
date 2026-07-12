import {
  Editor,
  config,
  init,
  parser,
  parserCtx,
  schema,
  serializer,
  serializerCtx,
} from '@milkdown/kit/core'
import { Clock, Container, Ctx } from '@milkdown/kit/ctx'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import {
  remarkGFMPlugin,
  tableCellSchema,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableRowSchema,
  tableSchema,
} from '@milkdown/kit/preset/gfm'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { addRowAfter, selectedRect, tableNodes } from '@milkdown/kit/prose/tables'
import { $node } from '@milkdown/kit/utils'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { normalizeTableSize } from '../src/renderer/src/editor/table-feature'
import { moveToAdjacentTableCell } from '../src/renderer/src/editor/table-navigation-plugin'

const timerEventTarget = new EventTarget()
const originalTimerGlobals = {
  addEventListener: Reflect.get(globalThis, 'addEventListener'),
  dispatchEvent: Reflect.get(globalThis, 'dispatchEvent'),
  removeEventListener: Reflect.get(globalThis, 'removeEventListener'),
}

beforeAll(() => {
  Reflect.set(
    globalThis,
    'addEventListener',
    timerEventTarget.addEventListener.bind(timerEventTarget),
  )
  Reflect.set(globalThis, 'dispatchEvent', timerEventTarget.dispatchEvent.bind(timerEventTarget))
  Reflect.set(
    globalThis,
    'removeEventListener',
    timerEventTarget.removeEventListener.bind(timerEventTarget),
  )
})

afterAll(() => {
  for (const [name, original] of Object.entries(originalTimerGlobals)) {
    if (original === undefined) Reflect.deleteProperty(globalThis, name)
    else Reflect.set(globalThis, name, original)
  }
})

const testDocSchema = $node('doc', () => ({
  content: 'block+',
  parseMarkdown: {
    match: (node) => node.type === 'root',
    runner: (state, node, type) => state.injectRoot(node, type),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'doc',
    runner: (state, node) => {
      state.openNode('root')
      state.next(node.content)
    },
  },
}))

const testParagraphSchema = $node('paragraph', () => ({
  content: 'inline*',
  group: 'block',
  parseMarkdown: {
    match: (node) => node.type === 'paragraph',
    runner: (state, node, type) => {
      state.openNode(type).next(node.children).closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'paragraph',
    runner: (state, node) => {
      state.openNode('paragraph').next(node.content).closeNode()
    },
  },
}))

const testTextSchema = $node('text', () => ({
  group: 'inline',
  parseMarkdown: {
    match: (node) => node.type === 'text',
    runner: (state, node) => state.addText(node.value as string),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'text',
    runner: (state, node) => state.addNode('text', undefined, node.text ?? ''),
  },
}))

interface PreparedPlugin {
  run: ReturnType<MilkdownPlugin>
}

function preparePlugin(ctx: Ctx, plugin: MilkdownPlugin): PreparedPlugin {
  return { run: plugin(ctx.produce()) }
}

async function serializeGfmMarkdown(markdown: string): Promise<string> {
  const ctx = new Ctx(new Container(), new Clock())
  const schemaPlugin = preparePlugin(ctx, schema)
  const parserPlugin = preparePlugin(ctx, parser)
  const serializerPlugin = preparePlugin(ctx, serializer)
  const initPlugin = preparePlugin(ctx, init(Editor.make()))
  const configPlugin = preparePlugin(
    ctx,
    config(() => undefined),
  )

  const contentPlugins: MilkdownPlugin[] = [
    testDocSchema,
    testParagraphSchema,
    testTextSchema,
    ...tableSchema,
    ...tableHeaderRowSchema,
    ...tableRowSchema,
    ...tableHeaderSchema,
    ...tableCellSchema,
    ...remarkGFMPlugin,
  ]
  const preparedContent = contentPlugins.map((plugin) => preparePlugin(ctx, plugin))

  // Start consumers before resolving their timers. Registering the remark
  // plugin first also guarantees GFM is present when the schema builds its
  // processor, while still avoiding creation of a DOM-backed EditorView.
  await Promise.all([
    ...preparedContent.map(({ run }) => run()),
    schemaPlugin.run(),
    parserPlugin.run(),
    serializerPlugin.run(),
    initPlugin.run(),
    configPlugin.run(),
  ])

  const document = ctx.get(parserCtx)(markdown)
  return ctx.get(serializerCtx)(document)
}

function createNavigationState(): EditorState {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'text*' },
      text: {},
      ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph', cellAttributes: {} }),
    },
  })
  const paragraph = schema.nodes.paragraph.create()
  const header = schema.nodes.table_header
  const cell = schema.nodes.table_cell
  const row = schema.nodes.table_row
  const table = schema.nodes.table
  const document = schema.nodes.doc.create(null, [
    table.create(null, [
      row.create(null, [header.create(null, paragraph), header.create(null, paragraph)]),
      row.create(null, [cell.create(null, paragraph), cell.create(null, paragraph)]),
    ]),
  ])

  const cells: number[] = []
  document.descendants((node, position) => {
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') {
      cells.push(position + 2)
    }
  })

  return EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, cells.at(-1)!),
  })
}

describe('GFM table feature', () => {
  it('serializes table content and column alignment as Markdown, not HTML', async () => {
    const markdown = [
      '| 名称 | 类型 | 状态 |',
      '| :--- | :---: | ---: |',
      '| OpenMD | 编辑器 | 开发中 |',
      '',
    ].join('\n')

    const serialized = await serializeGfmMarkdown(markdown)

    expect(serialized).toContain('| OpenMD')
    expect(serialized).toMatch(/\|\s*:?-+\s*\|\s*:-+:\s*\|\s*-+:\s*\|/)
    expect(serialized).not.toContain('<table')
    expect(serialized).not.toContain('<td')
  })

  it('adds a row and enters its first cell when Tab is pressed in the last cell', () => {
    let state = createNavigationState()
    const view = {
      get state(): EditorState {
        return state
      },
      dispatch(transaction: ReturnType<EditorState['tr']['setSelection']>): void {
        state = state.apply(transaction)
      },
    }

    const handled = moveToAdjacentTableCell(view, 1, () => addRowAfter(view.state, view.dispatch))

    expect(handled).toBe(true)
    expect(view.state.doc.firstChild?.childCount).toBe(3)
    expect(selectedRect(view.state)).toMatchObject({ top: 2, left: 0 })
  })

  it('clamps inserted tables to a valid GFM header and data shape', () => {
    expect(normalizeTableSize({ rows: 1, columns: 0 })).toEqual({ rows: 2, columns: 1 })
  })
})
