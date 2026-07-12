import { listItemSchema } from '@milkdown/kit/preset/commonmark'
import { $useKeymap } from '@milkdown/kit/utils'
import type { NodeType } from '@milkdown/prose/model'
import { liftListItem, sinkListItem, splitListItem } from '@milkdown/prose/schema-list'
import type { Command } from '@milkdown/prose/state'

const LIST_KEYMAP_PRIORITY = 100

/**
 * Indent the selected list item below its previous sibling.
 *
 * This is kept as a small command factory so the behavior can be exercised
 * without constructing a Milkdown editor in unit tests.
 */
export function indentListItem(listItemType: NodeType): Command {
  return sinkListItem(listItemType)
}

/** Lift the selected list item by one level, or out of its outer list. */
export function outdentListItem(listItemType: NodeType): Command {
  return liftListItem(listItemType)
}

/**
 * Continue a task list while resetting the new item's checked state.
 *
 * prosemirror-schema-list creates a list item with schema defaults when it
 * splits. For GFM task items that would turn the next item into a normal
 * bullet (`checked: null`). Passing explicit attrs keeps it a task and makes
 * the freshly-created item unchecked. Empty task items are lifted instead,
 * matching the usual "Enter exits/outdents the list" behavior.
 */
export function continueTaskListItem(listItemType: NodeType): Command {
  return (state, dispatch, view) => {
    const { $from, $to, empty } = state.selection
    if (
      $from.depth < 2 ||
      !$from.sameParent($to) ||
      $from.node(-1).type !== listItemType ||
      typeof $from.node(-1).attrs.checked !== 'boolean'
    ) {
      return false
    }

    const currentItem = $from.node(-1)
    if (empty && $from.parent.content.size === 0 && currentItem.childCount === 1) {
      return outdentListItem(listItemType)(state, dispatch, view)
    }

    return splitListItem(listItemType, {
      ...currentItem.attrs,
      checked: false,
    })(state, dispatch, view)
  }
}

/**
 * Common Markdown list shortcuts, with a task-aware Enter command ahead of
 * Milkdown's default list keymap. Commands return false outside list items so
 * table cells and CodeMirror can continue handling Tab themselves.
 */
export const listEditingPlugin = $useKeymap('openMdListEditing', {
  ContinueTaskListItem: {
    shortcuts: 'Enter',
    priority: LIST_KEYMAP_PRIORITY,
    command: (ctx) => continueTaskListItem(listItemSchema.type(ctx)),
  },
  IndentListItem: {
    shortcuts: ['Tab', 'Mod-]'],
    priority: LIST_KEYMAP_PRIORITY,
    command: (ctx) => indentListItem(listItemSchema.type(ctx)),
  },
  OutdentListItem: {
    shortcuts: ['Shift-Tab', 'Mod-['],
    priority: LIST_KEYMAP_PRIORITY,
    command: (ctx) => outdentListItem(listItemSchema.type(ctx)),
  },
})
