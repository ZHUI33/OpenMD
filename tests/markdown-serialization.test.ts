// @vitest-environment jsdom

import {
  Editor,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { deleteRow } from '@milkdown/prose/tables'
import { Transform } from '@milkdown/prose/transform'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let editor: Editor
let parseMarkdown: (markdown: string) => ProseMirrorNode
let serializeMarkdown: (document: ProseMirrorNode) => string

function findTextEnd(document: ProseMirrorNode, text: string): number {
  let result = -1
  document.descendants((node, position) => {
    if (result >= 0 || !node.isText) return
    const offset = node.text?.indexOf(text) ?? -1
    if (offset >= 0) result = position + offset + text.length
  })
  if (result < 0) throw new Error(`Text not found: ${text}`)
  return result
}

beforeAll(async () => {
  const root = document.createElement('div')
  document.body.append(root)

  editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: '-' as const,
        fence: '`' as const,
        fences: true,
        rule: '-' as const,
        ruleRepetition: 3,
        ruleSpaces: false,
      }))
    })
    .use(commonmark)
    .use(gfm)

  await editor.create()
  parseMarkdown = editor.action((ctx) => ctx.get(parserCtx))
  serializeMarkdown = editor.action((ctx) => ctx.get(serializerCtx))
})

afterAll(async () => {
  await editor.destroy()
})

describe('standard Markdown serialization', () => {
  it('serializes an editable table as GFM Markdown rather than HTML', () => {
    const source = [
      '| 名称 | 类型 | 状态 |',
      '| --- | :---: | ---: |',
      '| OpenMD | 编辑器 | 开发中 |',
    ].join('\n')

    const markdown = serializeMarkdown(parseMarkdown(source))

    expect(markdown).toContain('| 名称')
    expect(markdown).toContain('| OpenMD')
    expect(markdown).toMatch(/\|\s*:?-+:?\s*\|\s*:-+:\s*\|\s*-+:\s*\|/)
    expect(markdown).not.toMatch(/<table|<tr|<td/i)
  })

  it('keeps a valid GFM shape when deleting the only data row', () => {
    const opened = parseMarkdown('| 名称 | 状态 |\n| --- | --- |\n| OpenMD | 开发中 |')
    let dataCellPosition = -1
    opened.descendants((node, position) => {
      if (dataCellPosition < 0 && node.type.name === 'table_cell') {
        dataCellPosition = position + 2
      }
    })
    const state = EditorState.create({
      doc: opened,
      selection: TextSelection.create(opened, dataCellPosition),
    })
    let nextState: EditorState | undefined

    expect(
      deleteRow(state, (transaction) => {
        nextState = state.apply(transaction)
      }),
    ).toBe(true)
    expect(nextState).toBeDefined()
    const markdown = serializeMarkdown(nextState!.doc)

    expect(markdown).toContain('| 名称')
    expect(markdown).not.toMatch(/<table|<tr|<td/i)
    expect(() => parseMarkdown(markdown)).not.toThrow()
  })

  it('preserves checked and unchecked task-list states', () => {
    const markdown = serializeMarkdown(parseMarkdown('- [x] 已完成\n- [ ] 待处理'))

    expect(markdown).toContain('- [x] 已完成')
    expect(markdown).toContain('- [ ] 待处理')
  })

  it('preserves the fenced-code language identifier', () => {
    const markdown = serializeMarkdown(parseMarkdown('```java\npublic class Main {\n}\n```'))

    expect(markdown).toContain('```java\npublic class Main {\n}\n```')
  })

  it('opens, edits, saves, and reopens without losing Markdown semantics', () => {
    const source = [
      '# 示例文档',
      '',
      '正文包含 [链接](https://example.com) 和 `inline()`。',
      '',
      '- 普通项目',
      '- [ ] 任务项目',
      '',
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| OpenMD | 开发中 |',
      '',
      '```typescript',
      'const ready: boolean = true',
      '```',
    ].join('\n')

    const opened = parseMarkdown(source)
    const insertAt = findTextEnd(opened, '示例文档')
    // Use the opened document in a transaction so the test covers the same
    // ProseMirror edit -> Milkdown serializer path as the editor adapter.
    const editedDocument = new Transform(opened).insert(
      insertAt,
      opened.type.schema.text('（已编辑）'),
    ).doc
    const saved = serializeMarkdown(editedDocument)
    const reopened = parseMarkdown(saved)

    expect(saved).toContain('# 示例文档（已编辑）')
    expect(saved).toContain('[链接](https://example.com)')
    expect(saved).toContain('`inline()`')
    expect(saved).toContain('- [ ] 任务项目')
    expect(saved).toContain('| OpenMD')
    expect(saved).toContain('```typescript')
    expect(saved).not.toContain('<table')
    expect(serializeMarkdown(reopened)).toBe(saved)
  })
})
