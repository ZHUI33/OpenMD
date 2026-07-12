import { $prose } from '@milkdown/kit/utils'
import { splitBlock } from '@milkdown/prose/commands'
import { closeHistory, isHistoryTransaction } from '@milkdown/prose/history'
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'

interface HeadingSourceState {
  decorations: DecorationSet
  editingPosition: number | null
  editingTimestamp: number | null
}

type HeadingSourceMeta =
  | { type: 'start-editing'; position: number }
  | { type: 'request-finish' }
  | { type: 'finish-editing' }

interface ParsedHeadingSource {
  level: number
  prefixLength: number
}

const headingSourceKey = new PluginKey<HeadingSourceState>('openmd-heading-source')

export function isHeadingSourceEditing(state: EditorState): boolean {
  return headingSourceKey.getState(state)?.editingPosition != null
}

export function commitHeadingSourceEditing(view: EditorView): boolean {
  if (!isHeadingSourceEditing(view.state)) return false

  view.dispatch(
    view.state.tr.setMeta(headingSourceKey, {
      type: 'request-finish',
    } satisfies HeadingSourceMeta),
  )
  return true
}

function parseHeadingSource(paragraph: ProseMirrorNode): ParsedHeadingSource | undefined {
  if (paragraph.type.name !== 'paragraph') return undefined
  const match = /^( {0,3})(#{1,6})(?:[\t ]+|$)/.exec(paragraph.textContent)
  if (!match) return undefined
  return { level: match[2].length, prefixLength: match[0].length }
}

function selectionIsInsideNode(
  state: EditorState,
  position: number,
  node: ProseMirrorNode,
): boolean {
  return state.selection.from >= position + 1 && state.selection.to <= position + node.nodeSize - 1
}

function finishSourceEditing(state: EditorState, position: number): Transaction | undefined {
  const paragraph = state.doc.nodeAt(position)
  if (!paragraph || paragraph.type.name !== 'paragraph') return undefined

  const transaction = state.tr.setMeta(headingSourceKey, {
    type: 'finish-editing',
  } satisfies HeadingSourceMeta)
  const parsed = parseHeadingSource(paragraph)
  const headingType = state.schema.nodes.heading

  if (!parsed || !headingType) {
    return transaction.setMeta('addToHistory', false)
  }

  const heading = headingType.create(
    { level: parsed.level },
    paragraph.content.cut(parsed.prefixLength),
  )
  transaction.replaceWith(position, position + paragraph.nodeSize, heading)
  return transaction
}

function getTextOffset(element: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(node, offset)
  return range.toString().length
}

function getMarkerSelection(marker: HTMLElement):
  | {
      selection: globalThis.Selection
      start: number
      end: number
    }
  | undefined {
  const selection = window.getSelection()
  const anchorNode = selection?.anchorNode
  const focusNode = selection?.focusNode
  if (
    !selection ||
    !anchorNode ||
    !focusNode ||
    !marker.contains(anchorNode) ||
    !marker.contains(focusNode)
  ) {
    return undefined
  }

  const anchor = getTextOffset(marker, anchorNode, selection.anchorOffset)
  const focus = getTextOffset(marker, focusNode, selection.focusOffset)
  return {
    selection,
    start: Math.min(anchor, focus),
    end: Math.max(anchor, focus),
  }
}

function placeNativeCaret(element: HTMLElement, offset: number): void {
  const textNode = element.firstChild
  if (!textNode) return
  const range = document.createRange()
  range.setStart(textNode, Math.max(0, Math.min(offset, textNode.textContent?.length ?? 0)))
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function restoreSourceAsParagraph(
  view: EditorView,
  headingPosition: number,
  sourcePrefix: string,
  caretOffset: number,
): void {
  const heading = view.state.doc.nodeAt(headingPosition)
  const paragraph = view.state.schema.nodes.paragraph
  if (!heading || heading.type.name !== 'heading' || !paragraph) return

  const content = sourcePrefix
    ? heading.content.addToStart(view.state.schema.text(sourcePrefix))
    : heading.content
  const transaction = view.state.tr.replaceWith(
    headingPosition,
    headingPosition + heading.nodeSize,
    paragraph.create(null, content),
  )
  transaction.setSelection(
    TextSelection.create(transaction.doc, headingPosition + Math.max(0, caretOffset) + 1),
  )
  transaction.setMeta(headingSourceKey, {
    type: 'start-editing',
    position: headingPosition,
  } satisfies HeadingSourceMeta)
  view.dispatch(transaction)
  view.focus()
}

function createEditableMarker(
  view: EditorView,
  headingPosition: number,
  level: number,
): HTMLElement {
  // ProseMirror makes a widget's root non-editable, so the caret target must be a child.
  const widget = document.createElement('span')
  const marker = document.createElement('span')
  const originalSource = `${'#'.repeat(level)} `
  marker.className = 'openmd-heading-marker'
  marker.dataset.headingPosition = String(headingPosition)
  marker.textContent = originalSource
  marker.contentEditable = String(view.editable)
  marker.tabIndex = -1
  marker.spellcheck = false
  marker.setAttribute('aria-label', 'Markdown 标题标记')

  marker.addEventListener('keydown', (event) => {
    if (!view.editable || event.isComposing) return
    const markerSelection = getMarkerSelection(marker)
    if (!markerSelection?.selection.isCollapsed) return

    if (event.key === 'ArrowLeft' && markerSelection.start === 0) {
      event.preventDefault()
      const previousSelection = Selection.findFrom(
        view.state.doc.resolve(headingPosition),
        -1,
        true,
      )
      if (previousSelection) {
        view.dispatch(view.state.tr.setSelection(previousSelection))
        view.focus()
      }
      return
    }

    if (event.key === 'ArrowRight' && markerSelection.start >= level) {
      event.preventDefault()
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPosition + 1)),
      )
      view.focus()
    }
  })

  marker.addEventListener('beforeinput', (event) => {
    if (!view.editable) {
      event.preventDefault()
      return
    }
    if (event.isComposing) return
    const markerSelection = getMarkerSelection(marker)
    if (!markerSelection) return

    const source = marker.textContent ?? ''
    const { start, end } = markerSelection
    let nextSource = source
    let nextOffset = start

    event.preventDefault()

    if (event.inputType === 'deleteContentBackward') {
      if (start === end && start > 0) {
        nextSource = source.slice(0, start - 1) + source.slice(end)
        nextOffset = start - 1
      } else {
        nextSource = source.slice(0, start) + source.slice(end)
      }
    } else if (event.inputType === 'deleteContentForward') {
      nextSource = source.slice(0, start) + source.slice(start === end ? end + 1 : end)
    } else if (event.inputType === 'insertText' && event.data) {
      nextSource = source.slice(0, start) + event.data + source.slice(end)
      nextOffset = start + event.data.length
    } else {
      return
    }

    if (nextSource === source) return
    restoreSourceAsParagraph(view, headingPosition, nextSource, nextOffset)
  })

  marker.addEventListener('paste', (event) => {
    event.preventDefault()
    if (!view.editable) return
    const markerSelection = getMarkerSelection(marker)
    const pastedText = event.clipboardData?.getData('text/plain')
    if (!markerSelection || !pastedText) return

    const source = marker.textContent ?? ''
    const { start, end } = markerSelection
    const nextSource = source.slice(0, start) + pastedText + source.slice(end)
    restoreSourceAsParagraph(view, headingPosition, nextSource, start + pastedText.length)
  })

  marker.addEventListener('cut', (event) => {
    const markerSelection = getMarkerSelection(marker)
    if (!markerSelection || markerSelection.start === markerSelection.end) return
    event.preventDefault()
    if (!view.editable) return

    const source = marker.textContent ?? ''
    const { start, end } = markerSelection
    event.clipboardData?.setData('text/plain', source.slice(start, end))
    restoreSourceAsParagraph(
      view,
      headingPosition,
      source.slice(0, start) + source.slice(end),
      start,
    )
  })

  marker.addEventListener('compositionend', () => {
    if (!view.editable) return
    const source = marker.textContent ?? ''
    const markerSelection = getMarkerSelection(marker)
    if (source === originalSource || !markerSelection) return
    restoreSourceAsParagraph(view, headingPosition, source, markerSelection.end)
  })

  widget.append(marker)
  return widget
}

function createHeadingDecorations(
  documentNode: Parameters<typeof DecorationSet.create>[0],
  selection: Selection,
): DecorationSet {
  const { $from } = selection
  if ($from.parent.type.name !== 'heading') return DecorationSet.empty

  const headingPosition = $from.before($from.depth)
  const level = Number($from.parent.attrs.level)
  return DecorationSet.create(documentNode, [
    Decoration.node(headingPosition, headingPosition + $from.parent.nodeSize, {
      class: 'openmd-active-heading',
    }),
    Decoration.widget(
      headingPosition + 1,
      (view) => createEditableMarker(view, headingPosition, level),
      {
        key: `heading-marker-${headingPosition}-${level}`,
        side: -1,
        stopEvent: (event) =>
          event.target instanceof Element &&
          event.target.closest('.openmd-heading-marker') !== null,
        ignoreSelection: true,
      },
    ),
  ])
}

function syncMarkerEditability(view: EditorView): void {
  view.dom.querySelectorAll<HTMLElement>('.openmd-heading-marker').forEach((marker) => {
    marker.contentEditable = String(view.editable)
    if (!view.editable && marker === document.activeElement) view.focus()
  })
}

export const headingSourcePlugin = $prose(
  () =>
    new Plugin<HeadingSourceState>({
      key: headingSourceKey,
      state: {
        init: (_, state) => ({
          decorations: createHeadingDecorations(state.doc, state.selection),
          editingPosition: null,
          editingTimestamp: null,
        }),
        apply: (transaction, pluginState) => {
          const meta = transaction.getMeta(headingSourceKey) as HeadingSourceMeta | undefined
          let editingPosition = pluginState.editingPosition
          let editingTimestamp = pluginState.editingTimestamp

          if (meta?.type === 'start-editing') {
            editingPosition = meta.position
            editingTimestamp = transaction.time
          } else {
            if (editingPosition !== null && transaction.docChanged) {
              const mapped = transaction.mapping.mapResult(editingPosition, 1)
              editingPosition = mapped.deleted ? null : mapped.pos
            }
            if (meta?.type === 'finish-editing') {
              editingPosition = null
              editingTimestamp = null
            }
          }

          if (
            editingPosition !== null &&
            transaction.doc.nodeAt(editingPosition)?.type.name !== 'paragraph'
          ) {
            editingPosition = null
            editingTimestamp = null
          }

          return {
            decorations: createHeadingDecorations(transaction.doc, transaction.selection),
            editingPosition,
            editingTimestamp,
          }
        },
      },
      filterTransaction: (transaction, state) => {
        const pluginState = headingSourceKey.getState(state)
        if (
          pluginState &&
          pluginState.editingPosition !== null &&
          pluginState.editingTimestamp !== null &&
          transaction.docChanged &&
          !isHistoryTransaction(transaction)
        ) {
          // Keep one source-editing session in a single undo group, even after a typing pause.
          transaction.setTime(pluginState.editingTimestamp)
        }
        return true
      },
      appendTransaction: (transactions, _oldState, newState) => {
        const editingPosition = headingSourceKey.getState(newState)?.editingPosition
        if (editingPosition === null || editingPosition === undefined) return null
        const paragraph = newState.doc.nodeAt(editingPosition)
        // Finalize as an appended transaction so history and Markdown serialization stay in sync.
        const finishRequested = transactions.some(
          (transaction) =>
            (transaction.getMeta(headingSourceKey) as HeadingSourceMeta | undefined)?.type ===
            'request-finish',
        )
        if (
          !finishRequested &&
          paragraph &&
          paragraph.type.name === 'paragraph' &&
          selectionIsInsideNode(newState, editingPosition, paragraph)
        ) {
          return null
        }
        return finishSourceEditing(newState, editingPosition) ?? null
      },
      view: (view) => {
        syncMarkerEditability(view)
        const handleFocusOut = (event: FocusEvent): void => {
          const nextTarget = event.relatedTarget
          if (nextTarget instanceof Node && view.dom.contains(nextTarget)) return

          queueMicrotask(() => {
            const activeElement = view.root.activeElement
            if (activeElement && view.dom.contains(activeElement)) return
            const editingPosition = headingSourceKey.getState(view.state)?.editingPosition
            if (editingPosition === null || editingPosition === undefined) return
            view.dispatch(
              view.state.tr.setMeta(headingSourceKey, {
                type: 'request-finish',
              } satisfies HeadingSourceMeta),
            )
          })
        }

        view.dom.addEventListener('focusout', handleFocusOut)
        return {
          update: syncMarkerEditability,
          destroy: () => view.dom.removeEventListener('focusout', handleFocusOut),
        }
      },
      props: {
        decorations: (state) => headingSourceKey.getState(state)?.decorations,
        handleKeyDown: (view, event) => {
          if (!view.editable || event.isComposing) return false
          const editingPosition = headingSourceKey.getState(view.state)?.editingPosition
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            editingPosition !== null &&
            editingPosition !== undefined
          ) {
            const paragraph = view.state.doc.nodeAt(editingPosition)
            if (paragraph && parseHeadingSource(paragraph)) {
              event.preventDefault()
              view.dispatch(
                view.state.tr.setMeta(headingSourceKey, {
                  type: 'request-finish',
                } satisfies HeadingSourceMeta),
              )

              const heading = view.state.doc.nodeAt(editingPosition)
              const paragraphType = view.state.schema.nodes.paragraph
              if (!heading || heading.type.name !== 'heading' || !paragraphType) return true
              const nextPosition = editingPosition + heading.nodeSize
              const transaction = closeHistory(view.state.tr)
              const nextNode = transaction.doc.nodeAt(nextPosition)
              if (nextNode?.type !== paragraphType || nextNode.content.size > 0) {
                transaction.insert(nextPosition, paragraphType.create())
              }
              transaction.setSelection(TextSelection.create(transaction.doc, nextPosition + 1))
              transaction.scrollIntoView()
              view.dispatch(transaction)
              return true
            }

            event.preventDefault()
            view.dispatch(
              view.state.tr.setMeta(headingSourceKey, {
                type: 'finish-editing',
              } satisfies HeadingSourceMeta),
            )
            splitBlock(view.state, view.dispatch)
            return true
          }

          const { $from, empty } = view.state.selection
          if (!empty || $from.parent.type.name !== 'heading' || $from.parentOffset !== 0) {
            return false
          }

          const position = $from.before($from.depth)
          const level = Number($from.parent.attrs.level)

          if (event.key === 'ArrowLeft') {
            const marker = view.dom.querySelector<HTMLElement>(
              `.openmd-heading-marker[data-heading-position="${position}"]`,
            )
            if (!marker) return false
            event.preventDefault()
            marker.focus()
            placeNativeCaret(marker, level)
            return true
          }

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
            restoreSourceAsParagraph(view, position, '#'.repeat(level), level)
            return true
          }

          return false
        },
      },
    }),
)
