import { Fragment } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection, isInTable, selectedRect } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export function parseTsvRectangle(text: string): string[][] {
  const normalized = text.replace(/\r\n|\r/g, '\n')
  const rows = normalized.split('\n')
  if (rows.length > 1 && rows.at(-1) === '') rows.pop()
  return rows.map((row) => row.split('\t'))
}

export function serializeSelectedTableRectangle(state: EditorState): string | undefined {
  if (!(state.selection instanceof CellSelection)) return undefined
  const rect = selectedRect(state)
  const rows: string[] = []
  for (let row = rect.top; row < rect.bottom; row += 1) {
    const cells: string[] = []
    for (let column = rect.left; column < rect.right; column += 1) {
      const relativePosition = rect.map.map[row * rect.map.width + column]
      const cell = relativePosition === undefined ? undefined : rect.table.nodeAt(relativePosition)
      cells.push(cell?.textContent ?? '')
    }
    rows.push(cells.join('\t'))
  }
  return rows.join('\n')
}

interface TableClipboardView {
  dispatch(transaction: Transaction): void
  readonly state: EditorState
}

/**
 * Paste a plain-text TSV rectangle starting at the active cell. Values outside
 * the existing table are clipped; row/column insertion remains an explicit
 * table command so paste never changes the table shape unexpectedly.
 */
export function pasteTableRectangle(view: TableClipboardView, text: string): boolean {
  if (!isInTable(view.state)) return false
  const matrix = parseTsvRectangle(text)
  const hasRectangle = matrix.length > 1 || matrix.some((row) => row.length > 1)
  if (!hasRectangle && !(view.state.selection instanceof CellSelection)) return false

  const rect = selectedRect(view.state)
  const paragraph = view.state.schema.nodes.paragraph
  if (!paragraph) return false
  const replacements: Array<{ position: number; value: string }> = []
  const seen = new Set<number>()

  matrix.forEach((rowValues, rowOffset) => {
    const row = rect.top + rowOffset
    if (row >= rect.map.height) return
    rowValues.forEach((value, columnOffset) => {
      const column = rect.left + columnOffset
      if (column >= rect.map.width) return
      const relativePosition = rect.map.map[row * rect.map.width + column]
      if (relativePosition === undefined || seen.has(relativePosition)) return
      seen.add(relativePosition)
      replacements.push({ position: rect.tableStart + relativePosition, value })
    })
  })
  if (replacements.length === 0) return false

  let transaction = view.state.tr
  const firstCellPosition = replacements[0]!.position
  replacements
    .sort((left, right) => right.position - left.position)
    .forEach(({ position, value }) => {
      const cell = transaction.doc.nodeAt(position)
      if (!cell || !['table_cell', 'table_header'].includes(cell.type.name)) return
      const textNode = value ? view.state.schema.text(value) : undefined
      const content = paragraph.create(null, textNode)
      transaction = transaction.replaceWith(
        position + 1,
        position + cell.nodeSize - 1,
        Fragment.from(content),
      )
    })

  const mappedSelection = Math.min(
    transaction.doc.content.size,
    transaction.mapping.map(firstCellPosition + 2),
  )
  transaction = transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(mappedSelection), 1),
  )
  view.dispatch(transaction.scrollIntoView())
  return true
}

const tableClipboardKey = new PluginKey('openmd-table-clipboard')

export const tableClipboardPlugin = $prose(
  () =>
    new Plugin({
      key: tableClipboardKey,
      props: {
        handleDOMEvents: {
          copy: (view: EditorView, event: ClipboardEvent) => {
            const text = serializeSelectedTableRectangle(view.state)
            if (text === undefined || !event.clipboardData) return false
            event.preventDefault()
            event.clipboardData.setData('text/plain', text)
            return true
          },
          paste: (view: EditorView, event: ClipboardEvent) => {
            const text = event.clipboardData?.getData('text/plain')
            if (text == null || !pasteTableRectangle(view, text)) return false
            event.preventDefault()
            return true
          },
        },
      },
    }),
)
