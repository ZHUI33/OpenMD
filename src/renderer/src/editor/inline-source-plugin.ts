import { parserCtx, serializerCtx } from '@milkdown/kit/core'
import { Fragment } from '@milkdown/prose/model'
import type { Mark, Node as ProseMirrorNode, Schema } from '@milkdown/prose/model'
import { closeHistory, isHistoryTransaction } from '@milkdown/prose/history'
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'
import { $prose } from '@milkdown/kit/utils'

interface InlineSourceState {
  decorations: DecorationSet
  editingPosition: number | null
  editingTimestamp: number | null
}

type InlineSourceMeta =
  | { type: 'start-editing'; position: number }
  | { type: 'request-finish' }
  | { type: 'finish-editing' }

interface MarkSpan {
  mark: Mark
  from: number
  to: number
  text: string
  open: string
  close: string
}

interface MarkerBoundary {
  position: number
  openLength: number
  closeLength: number
}

interface EditableInlineMarker extends HTMLElement {
  openmdDeleteBackward: () => void
  openmdDeleteForward: () => void
}

const inlineMarkNames = new Set(['strong', 'emphasis', 'strike_through', 'inlineCode', 'link'])

const inlineSourceKey = new PluginKey<InlineSourceState>('openmd-inline-source')
const markerSentinel = 'OPENMDMARKERBOUNDARY'

export function isInlineSourceEditing(state: EditorState): boolean {
  return inlineSourceKey.getState(state)?.editingPosition != null
}

function trimSerializedBlock(markdown: string): string {
  return markdown.replace(/\r?\n$/, '')
}

function serializeParagraph(
  paragraph: ProseMirrorNode,
  schema: Schema,
  serializer: (node: ProseMirrorNode) => string,
): string {
  const documentNode = schema.topNodeType.create(null, paragraph)
  return trimSerializedBlock(serializer(documentNode))
}

function marksAtBoundary(paragraph: ProseMirrorNode, offset: number): readonly Mark[] {
  const before = paragraph.childBefore(offset).node?.marks ?? []
  const after = paragraph.childAfter(offset).node?.marks ?? []
  return before.filter((leftMark) => after.some((rightMark) => leftMark.eq(rightMark)))
}

function sourceOffsetAtBoundary(
  paragraph: ProseMirrorNode,
  paragraphOffset: number,
  schema: Schema,
  serializer: (node: ProseMirrorNode) => string,
): number | undefined {
  const sentinel = schema.text(markerSentinel, marksAtBoundary(paragraph, paragraphOffset))
  const content = paragraph.content
    .cut(0, paragraphOffset)
    .append(Fragment.from(sentinel))
    .append(paragraph.content.cut(paragraphOffset))
  const temporaryParagraph = paragraph.type.create(paragraph.attrs, content)
  const markdown = serializeParagraph(temporaryParagraph, schema, serializer)
  const index = markdown.indexOf(markerSentinel)
  return index < 0 ? undefined : index
}

function markTokens(
  mark: Mark,
  text: string,
  schema: Schema,
  serializer: (node: ProseMirrorNode) => string,
): { open: string; close: string } | undefined {
  const probe = mark.type.name === 'inlineCode' ? text || markerSentinel : markerSentinel
  const paragraph = schema.nodes.paragraph
  if (!paragraph) return undefined

  const markedText = schema.text(probe, [mark])
  const temporaryParagraph = paragraph.create(null, markedText)
  const markdown = serializeParagraph(temporaryParagraph, schema, serializer)
  const index = markdown.indexOf(probe)
  if (index < 0) return undefined

  return {
    open: markdown.slice(0, index),
    close: markdown.slice(index + probe.length),
  }
}

function collectMarkSpans(
  paragraph: ProseMirrorNode,
  paragraphPosition: number,
  schema: Schema,
  serializer: (node: ProseMirrorNode) => string,
): MarkSpan[] {
  const spans: MarkSpan[] = []

  paragraph.descendants((node, offset) => {
    if (!node.isText) return

    const from = paragraphPosition + 1 + offset
    const to = from + node.nodeSize
    node.marks.forEach((mark) => {
      if (!inlineMarkNames.has(mark.type.name)) return

      const previous = [...spans].reverse().find((span) => span.to === from && span.mark.eq(mark))
      if (previous) {
        previous.to = to
        previous.text += node.text ?? ''
        return
      }

      const tokens = markTokens(mark, node.text ?? '', schema, serializer)
      if (!tokens) return
      spans.push({
        mark,
        from,
        to,
        text: node.text ?? '',
        ...tokens,
      })
    })
  })

  // Inline-code fences depend on the complete marked text, not the first text node.
  spans.forEach((span) => {
    if (span.mark.type.name !== 'inlineCode') return
    const tokens = markTokens(span.mark, span.text, schema, serializer)
    if (tokens) {
      span.open = tokens.open
      span.close = tokens.close
    }
  })

  return spans
}

function collectBoundaries(spans: MarkSpan[]): MarkerBoundary[] {
  const boundaries = new Map<number, MarkerBoundary>()
  const getBoundary = (position: number): MarkerBoundary => {
    const current = boundaries.get(position)
    if (current) return current
    const created = { position, openLength: 0, closeLength: 0 }
    boundaries.set(position, created)
    return created
  }

  spans.forEach((span) => {
    getBoundary(span.from).openLength += span.open.length
    getBoundary(span.to).closeLength += span.close.length
  })

  return [...boundaries.values()].sort((left, right) => left.position - right.position)
}

function getTextOffset(element: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(node, offset)
  return range.toString().length
}

function getMarkerSelection(marker: HTMLElement):
  | {
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
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }
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

function nativeCaretTouchesMarker(
  view: EditorView,
  marker: HTMLElement,
  side: 'before' | 'after',
): boolean {
  const selection = window.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return false
  const caret = selection.getRangeAt(0)
  if (!view.dom.contains(caret.startContainer) || marker.contains(caret.startContainer)) {
    return false
  }

  const widget = marker.closest('.ProseMirror-widget') ?? marker
  const markerBoundary = document.createRange()
  markerBoundary.selectNode(widget)
  markerBoundary.collapse(side === 'before')
  const relation = caret.compareBoundaryPoints(Range.START_TO_START, markerBoundary)
  if ((side === 'after' && relation < 0) || (side === 'before' && relation > 0)) {
    return false
  }

  const gap = document.createRange()
  try {
    if (side === 'after') {
      gap.setStartAfter(widget)
      gap.setEnd(caret.startContainer, caret.startOffset)
    } else {
      gap.setStart(caret.startContainer, caret.startOffset)
      gap.setEndBefore(widget)
    }
  } catch {
    return false
  }
  return gap.toString().length === 0
}

function handleMarkerBoundaryDelete(view: EditorView, event: KeyboardEvent): boolean {
  if (
    !view.state.selection.empty ||
    (event.key !== 'Backspace' && event.key !== 'Delete') ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return false
  }

  const position = view.state.selection.from
  const markers = view.dom.querySelectorAll<EditableInlineMarker>(
    `.openmd-inline-marker[data-boundary-position="${position}"]`,
  )
  const side = event.key === 'Backspace' ? 'after' : 'before'
  const marker = [...markers].find((candidate) => nativeCaretTouchesMarker(view, candidate, side))
  if (!marker || !marker.textContent) return false

  event.preventDefault()
  if (event.key === 'Backspace') marker.openmdDeleteBackward()
  else marker.openmdDeleteForward()
  return true
}

function selectionIsInsideNode(
  state: EditorState,
  position: number,
  node: ProseMirrorNode,
): boolean {
  return state.selection.from >= position + 1 && state.selection.to <= position + node.nodeSize - 1
}

function startSourceEditing(
  view: EditorView,
  paragraphPosition: number,
  source: string,
  sourceFrom: number,
  sourceTo: number,
  replacement: string,
  caretInReplacement: number,
): void {
  const paragraph = view.state.doc.nodeAt(paragraphPosition)
  const paragraphType = view.state.schema.nodes.paragraph
  if (!paragraph || paragraph.type.name !== 'paragraph' || !paragraphType) return

  const nextSource = source.slice(0, sourceFrom) + replacement + source.slice(sourceTo)
  const content = nextSource ? view.state.schema.text(nextSource) : undefined
  const transaction = view.state.tr.replaceWith(
    paragraphPosition,
    paragraphPosition + paragraph.nodeSize,
    paragraphType.create(null, content),
  )
  transaction.setSelection(
    TextSelection.create(transaction.doc, paragraphPosition + 1 + sourceFrom + caretInReplacement),
  )
  transaction.setMeta(inlineSourceKey, {
    type: 'start-editing',
    position: paragraphPosition,
  } satisfies InlineSourceMeta)
  view.dispatch(transaction)
  view.focus()
}

function createEditableMarker(
  view: EditorView,
  paragraphPosition: number,
  boundaryPosition: number,
  source: string,
  sourceFrom: number,
  sourceTo: number,
): HTMLElement {
  const widget = document.createElement('span')
  const marker = document.createElement('span')
  const originalMarker = source.slice(sourceFrom, sourceTo)
  marker.className = 'openmd-inline-marker'
  marker.dataset.boundaryPosition = String(boundaryPosition)
  marker.textContent = originalMarker
  marker.contentEditable = String(view.editable)
  marker.tabIndex = -1
  marker.spellcheck = false
  marker.setAttribute('aria-label', 'Markdown 行内标记')

  const applyMarker = (nextMarker: string, caretOffset: number): void => {
    if (nextMarker === originalMarker) return
    startSourceEditing(
      view,
      paragraphPosition,
      source,
      sourceFrom,
      sourceTo,
      nextMarker,
      caretOffset,
    )
  }

  const editableMarker = marker as EditableInlineMarker
  editableMarker.openmdDeleteBackward = () => {
    const current = marker.textContent ?? ''
    if (!current) return
    applyMarker(current.slice(0, -1), current.length - 1)
  }
  editableMarker.openmdDeleteForward = () => {
    const current = marker.textContent ?? ''
    if (!current) return
    applyMarker(current.slice(1), 0)
  }

  marker.addEventListener('keydown', (event) => {
    if (!view.editable || event.isComposing) return
    const markerSelection = getMarkerSelection(marker)
    if (!markerSelection || markerSelection.start !== markerSelection.end) return

    if (event.key === 'ArrowLeft' && markerSelection.start === 0) {
      event.preventDefault()
      const previous = Selection.findFrom(view.state.doc.resolve(boundaryPosition), -1, true)
      if (previous) {
        view.dispatch(view.state.tr.setSelection(previous))
        view.focus()
      }
    } else if (
      event.key === 'ArrowRight' &&
      markerSelection.end === (marker.textContent?.length ?? 0)
    ) {
      event.preventDefault()
      const next = Selection.findFrom(view.state.doc.resolve(boundaryPosition), 1, true)
      if (next) {
        view.dispatch(view.state.tr.setSelection(next))
        view.focus()
      }
    }
  })

  marker.addEventListener('beforeinput', (event) => {
    if (!view.editable) {
      event.preventDefault()
      return
    }
    if (event.isComposing) return
    const selection = getMarkerSelection(marker)
    if (!selection) return

    const current = marker.textContent ?? ''
    const { start, end } = selection
    let next = current
    let caret = start
    event.preventDefault()

    if (event.inputType === 'deleteContentBackward') {
      if (start === end && start > 0) {
        next = current.slice(0, start - 1) + current.slice(end)
        caret = start - 1
      } else {
        next = current.slice(0, start) + current.slice(end)
      }
    } else if (event.inputType === 'deleteContentForward') {
      next = current.slice(0, start) + current.slice(start === end ? end + 1 : end)
    } else if (event.inputType === 'insertText' && event.data != null) {
      next = current.slice(0, start) + event.data + current.slice(end)
      caret = start + event.data.length
    } else {
      return
    }

    applyMarker(next, caret)
  })

  marker.addEventListener('paste', (event) => {
    event.preventDefault()
    if (!view.editable) return
    const selection = getMarkerSelection(marker)
    const pasted = event.clipboardData?.getData('text/plain')
    if (!selection || pasted == null) return
    const current = marker.textContent ?? ''
    const next = current.slice(0, selection.start) + pasted + current.slice(selection.end)
    applyMarker(next, selection.start + pasted.length)
  })

  marker.addEventListener('cut', (event) => {
    const selection = getMarkerSelection(marker)
    if (!selection || selection.start === selection.end) return
    event.preventDefault()
    if (!view.editable) return
    const current = marker.textContent ?? ''
    event.clipboardData?.setData('text/plain', current.slice(selection.start, selection.end))
    applyMarker(current.slice(0, selection.start) + current.slice(selection.end), selection.start)
  })

  marker.addEventListener('compositionend', () => {
    if (!view.editable) return
    const selection = getMarkerSelection(marker)
    if (!selection) return
    applyMarker(marker.textContent ?? '', selection.end)
  })

  widget.append(marker)
  return widget
}

function createDecorations(
  state: EditorState,
  serializer: (node: ProseMirrorNode) => string,
  editingPosition: number | null,
): DecorationSet {
  if (editingPosition !== null) {
    const paragraph = state.doc.nodeAt(editingPosition)
    if (!paragraph || paragraph.type.name !== 'paragraph') return DecorationSet.empty
    return DecorationSet.create(state.doc, [
      Decoration.node(editingPosition, editingPosition + paragraph.nodeSize, {
        class: 'openmd-markdown-source',
      }),
    ])
  }

  const { $from } = state.selection
  if ($from.parent.type.name !== 'paragraph') return DecorationSet.empty
  const paragraph = $from.parent
  const paragraphPosition = $from.before($from.depth)
  const spans = collectMarkSpans(paragraph, paragraphPosition, state.schema, serializer)
  if (spans.length === 0) return DecorationSet.empty

  const source = serializeParagraph(paragraph, state.schema, serializer)
  const decorations: Decoration[] = spans.map((span) =>
    Decoration.inline(span.from, span.to, { class: 'openmd-active-inline-source' }),
  )

  collectBoundaries(spans).forEach((boundary) => {
    const paragraphOffset = boundary.position - paragraphPosition - 1
    const sourceBoundary = sourceOffsetAtBoundary(
      paragraph,
      paragraphOffset,
      state.schema,
      serializer,
    )
    if (sourceBoundary === undefined) return

    const sourceFrom = Math.max(0, sourceBoundary - boundary.closeLength)
    const sourceTo = Math.min(source.length, sourceBoundary + boundary.openLength)
    if (sourceFrom === sourceTo) return

    decorations.push(
      Decoration.widget(
        boundary.position,
        (view) =>
          createEditableMarker(
            view,
            paragraphPosition,
            boundary.position,
            source,
            sourceFrom,
            sourceTo,
          ),
        {
          key: `inline-marker-${boundary.position}-${source.slice(sourceFrom, sourceTo)}`,
          side: -1,
          stopEvent: (event) =>
            event.target instanceof Element &&
            event.target.closest('.openmd-inline-marker') !== null,
          ignoreSelection: true,
        },
      ),
    )
  })

  return DecorationSet.create(state.doc, decorations)
}

function finishSourceEditing(
  state: EditorState,
  position: number,
  parser: (markdown: string) => ProseMirrorNode,
): Transaction | undefined {
  const paragraph = state.doc.nodeAt(position)
  if (!paragraph || paragraph.type.name !== 'paragraph') return undefined

  const transaction = state.tr.setMeta(inlineSourceKey, {
    type: 'finish-editing',
  } satisfies InlineSourceMeta)
  const parsed = parser(paragraph.textContent)
  transaction.replaceWith(position, position + paragraph.nodeSize, parsed.content)

  if (selectionIsInsideNode(state, position, paragraph)) {
    const end = Math.min(transaction.doc.content.size, position + parsed.content.size)
    transaction.setSelection(Selection.near(transaction.doc.resolve(end), -1))
  }
  return transaction
}

function syncMarkerEditability(view: EditorView): void {
  view.dom.querySelectorAll<HTMLElement>('.openmd-inline-marker').forEach((marker) => {
    marker.contentEditable = String(view.editable)
    if (!view.editable && marker === document.activeElement) view.focus()
  })
}

function insertParagraphAfterCurrentBlock(view: EditorView): void {
  const paragraph = view.state.schema.nodes.paragraph
  if (!paragraph) return
  const { $from } = view.state.selection
  if ($from.parent.type === paragraph && $from.parent.content.size === 0) {
    view.dispatch(
      closeHistory(view.state.tr)
        .setSelection(TextSelection.create(view.state.doc, $from.start()))
        .scrollIntoView(),
    )
    return
  }
  let insertPosition = view.state.selection.to
  if ($from.depth >= 1) {
    insertPosition = $from.before(1) + $from.node(1).nodeSize
  } else {
    const selectedNode = view.state.doc.nodeAt(view.state.selection.from)
    if (selectedNode) insertPosition = view.state.selection.from + selectedNode.nodeSize
  }

  const transaction = closeHistory(view.state.tr)
  const nextNode = transaction.doc.nodeAt(insertPosition)
  if (nextNode?.type !== paragraph || nextNode.content.size > 0) {
    transaction.insert(insertPosition, paragraph.create())
  }
  transaction.setSelection(TextSelection.create(transaction.doc, insertPosition + 1))
  transaction.scrollIntoView()
  view.dispatch(transaction)
}

export const inlineSourcePlugin = $prose((ctx) => {
  // Parser/serializer slices are populated after prose plugins are registered.
  // Resolve them lazily instead of capturing Milkdown's out-of-scope placeholder.
  const parser = (markdown: string): ProseMirrorNode => ctx.get(parserCtx)(markdown)
  const serializer = (node: ProseMirrorNode): string => ctx.get(serializerCtx)(node)

  return new Plugin<InlineSourceState>({
    key: inlineSourceKey,
    state: {
      init: (_, state) => ({
        decorations: createDecorations(state, serializer, null),
        editingPosition: null,
        editingTimestamp: null,
      }),
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(inlineSourceKey) as InlineSourceMeta | undefined
        let editingPosition = pluginState.editingPosition
        let editingTimestamp = pluginState.editingTimestamp

        if (meta?.type === 'start-editing') {
          editingPosition = meta.position
          editingTimestamp = transaction.time
        } else if (meta?.type === 'finish-editing') {
          editingPosition = null
          editingTimestamp = null
        } else if (editingPosition !== null && transaction.docChanged) {
          const mapped = transaction.mapping.mapResult(editingPosition, 1)
          editingPosition = mapped.deleted ? null : mapped.pos
        }

        if (
          editingPosition !== null &&
          newState.doc.nodeAt(editingPosition)?.type.name !== 'paragraph'
        ) {
          editingPosition = null
          editingTimestamp = null
        }

        return {
          decorations: createDecorations(newState, serializer, editingPosition),
          editingPosition,
          editingTimestamp,
        }
      },
    },
    filterTransaction: (transaction, state) => {
      const pluginState = inlineSourceKey.getState(state)
      if (
        pluginState?.editingPosition != null &&
        pluginState.editingTimestamp != null &&
        transaction.docChanged &&
        !isHistoryTransaction(transaction)
      ) {
        transaction.setTime(pluginState.editingTimestamp)
      }
      return true
    },
    appendTransaction: (transactions, _oldState, newState) => {
      const editingPosition = inlineSourceKey.getState(newState)?.editingPosition
      if (editingPosition == null) return null
      const paragraph = newState.doc.nodeAt(editingPosition)
      const finishRequested = transactions.some(
        (transaction) =>
          (transaction.getMeta(inlineSourceKey) as InlineSourceMeta | undefined)?.type ===
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
      return finishSourceEditing(newState, editingPosition, parser) ?? null
    },
    view: (view) => {
      syncMarkerEditability(view)
      const handleFocusOut = (event: FocusEvent): void => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && view.dom.contains(nextTarget)) return

        queueMicrotask(() => {
          const activeElement = view.root.activeElement
          if (activeElement && view.dom.contains(activeElement)) return
          if (!isInlineSourceEditing(view.state)) return
          view.dispatch(
            view.state.tr.setMeta(inlineSourceKey, {
              type: 'request-finish',
            } satisfies InlineSourceMeta),
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
      decorations: (state) => inlineSourceKey.getState(state)?.decorations,
      handleKeyDown: (view, event) => {
        if (!view.editable || event.isComposing) return false
        if (!isInlineSourceEditing(view.state) && handleMarkerBoundaryDelete(view, event)) {
          return true
        }
        if (event.key !== 'Enter' || !isInlineSourceEditing(view.state)) return false

        event.preventDefault()
        view.dispatch(
          view.state.tr.setMeta(inlineSourceKey, {
            type: 'request-finish',
          } satisfies InlineSourceMeta),
        )
        insertParagraphAfterCurrentBlock(view)
        return true
      },
      handleClick: (_view, _position, event) => {
        const marker =
          event.target instanceof Element &&
          event.target.closest<HTMLElement>('.openmd-inline-marker')
        if (!marker) return false
        marker.focus()
        placeNativeCaret(marker, marker.textContent?.length ?? 0)
        return true
      },
    },
  })
})
