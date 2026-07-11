import { Plugin, PluginKey } from '@milkdown/prose/state'
import type { Selection } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { $prose } from '@milkdown/kit/utils'

const headingSourceKey = new PluginKey<DecorationSet>('openmd-heading-source')

function createHeadingDecorations(
  documentNode: Parameters<typeof DecorationSet.create>[0],
  selection: Selection,
): DecorationSet {
  const { $from } = selection
  if ($from.parent.type.name !== 'heading') return DecorationSet.empty

  const headingPosition = $from.before($from.depth)
  const level = Number($from.parent.attrs.level)
  const marker = document.createElement('span')
  marker.className = 'openmd-heading-marker'
  marker.textContent = `${'#'.repeat(level)} `
  marker.contentEditable = 'false'
  marker.setAttribute('aria-hidden', 'true')

  return DecorationSet.create(documentNode, [
    Decoration.node(headingPosition, headingPosition + $from.parent.nodeSize, {
      class: 'openmd-active-heading',
    }),
    Decoration.widget(headingPosition + 1, marker, {
      key: `heading-marker-${headingPosition}-${level}`,
      side: -1,
    }),
  ])
}

export const headingSourcePlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: headingSourceKey,
      state: {
        init: (_, state) => createHeadingDecorations(state.doc, state.selection),
        apply: (transaction) => createHeadingDecorations(transaction.doc, transaction.selection),
      },
      props: {
        decorations: (state) => headingSourceKey.getState(state),
        handleKeyDown: (view, event) => {
          if (event.isComposing) return false

          const { $from, empty } = view.state.selection
          if (!empty || $from.parent.type.name !== 'heading' || $from.parentOffset !== 0) {
            return false
          }

          const position = $from.before($from.depth)
          const level = Number($from.parent.attrs.level)

          if (event.key === '#' && level < 6) {
            view.dispatch(
              view.state.tr.setNodeMarkup(position, undefined, {
                ...$from.parent.attrs,
                level: level + 1,
              }),
            )
            return true
          }

          if (event.key === 'Backspace') {
            const transaction =
              level > 1
                ? view.state.tr.setNodeMarkup(position, undefined, {
                    ...$from.parent.attrs,
                    level: level - 1,
                  })
                : view.state.tr.setNodeMarkup(position, view.state.schema.nodes.paragraph)
            view.dispatch(transaction)
            return true
          }

          return false
        },
      },
    }),
)
