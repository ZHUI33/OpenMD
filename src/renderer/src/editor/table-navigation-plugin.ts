import { commandsCtx } from '@milkdown/kit/core'
import { addRowAfterCommand } from '@milkdown/kit/preset/gfm'
import { isInTable, goToNextCell } from '@milkdown/kit/prose/tables'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

type TableNavigationView = Pick<EditorView, 'dispatch' | 'state'>

const tableNavigationKey = new PluginKey('openmd-table-navigation')

/**
 * Move between GFM table cells and append a data row when Tab is pressed in
 * the final cell. Keeping this as a small exported function makes the behavior
 * testable without constructing an EditorView or touching the DOM.
 */
export function moveToAdjacentTableCell(
  view: TableNavigationView,
  direction: -1 | 1,
  appendRow: () => boolean,
): boolean {
  if (!isInTable(view.state)) return false

  const move = (): boolean => goToNextCell(direction)(view.state, view.dispatch)
  const moved = move()
  if (moved || direction < 0) return moved

  if (!appendRow()) return false
  return goToNextCell(1)(view.state, view.dispatch)
}

/**
 * Milkdown's stock table keymap stops at the final cell. This plugin runs
 * before that keymap, preserves normal Tab/Shift+Tab navigation, and adds the
 * familiar "Tab in the last cell creates a row" behavior.
 */
export const tableNavigationPlugin = $prose(
  (ctx) =>
    new Plugin({
      key: tableNavigationKey,
      props: {
        handleKeyDown: (view, event) => {
          if (
            event.key !== 'Tab' ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          ) {
            return false
          }

          if (event.isComposing || view.composing) return false

          const handled = moveToAdjacentTableCell(view, event.shiftKey ? -1 : 1, () =>
            ctx.get(commandsCtx).call(addRowAfterCommand.key),
          )
          if (handled) event.preventDefault()
          return handled
        },
      },
    }),
)
