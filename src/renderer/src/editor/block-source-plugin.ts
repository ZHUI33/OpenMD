import { parserCtx, serializerCtx } from '@milkdown/kit/core'
import { closeHistory, isHistoryTransaction } from '@milkdown/prose/history'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { Plugin, PluginKey, Selection, TextSelection } from '@milkdown/prose/state'
import type { EditorState, Transaction } from '@milkdown/prose/state'
import { Transform } from '@milkdown/prose/transform'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'
import { $prose } from '@milkdown/kit/utils'

interface BlockSourceState {
  decorations: DecorationSet
  editingPosition: number | null
  editingTimestamp: number | null
  originalNode: ProseMirrorNode | null
}

type BlockSourceMeta =
  | { type: 'start-editing'; position: number; originalNode: ProseMirrorNode }
  | { type: 'request-finish' }
  | { type: 'finish-editing' }
  | { type: 'cancel-editing' }

interface TopLevelBlock {
  node: ProseMirrorNode
  position: number
}

interface SourceMarker {
  documentPosition: number
  selectionPosition?: number
  source: string
  sourceFrom: number
  sourceTo: number
  className?: string
  side?: number
}

interface EditableBlockMarker extends HTMLElement {
  openmdDeleteBackward: () => void
  openmdDeleteForward: () => void
}

const supportedBlockNames = new Set([
  'blockquote',
  'bullet_list',
  'ordered_list',
  'code_block',
  'hr',
])

const blockSourceKey = new PluginKey<BlockSourceState>('openmd-block-source')
const markerSentinel = 'OPENMDBLOCKBOUNDARY'

export function isBlockSourceEditing(state: EditorState): boolean {
  return blockSourceKey.getState(state)?.editingPosition != null
}

export function commitBlockSourceEditing(view: EditorView): boolean {
  if (!isBlockSourceEditing(view.state)) return false

  view.dispatch(
    view.state.tr.setMeta(blockSourceKey, {
      type: 'request-finish',
    } satisfies BlockSourceMeta),
  )
  return true
}

function trimSerializedBlock(markdown: string): string {
  return markdown.replace(/\r?\n$/, '')
}

function serializeTopLevelNode(
  state: EditorState,
  node: ProseMirrorNode,
  serializer: (node: ProseMirrorNode) => string,
): string {
  return trimSerializedBlock(serializer(state.schema.topNodeType.create(null, node)))
}

function topLevelBlockAtSelection(state: EditorState): TopLevelBlock | undefined {
  const { $from } = state.selection
  if ($from.depth >= 1) {
    return { node: $from.node(1), position: $from.before(1) }
  }

  const node = state.doc.nodeAt(state.selection.from)
  if (!node) return undefined
  return { node, position: state.selection.from }
}

function selectionIsInsideNode(
  state: EditorState,
  position: number,
  node: ProseMirrorNode,
): boolean {
  return state.selection.from >= position + 1 && state.selection.to <= position + node.nodeSize - 1
}

function sourcePrefixAtTextblock(
  state: EditorState,
  topLevelNode: ProseMirrorNode,
  topLevelPosition: number,
  textblockContentPosition: number,
  serializer: (node: ProseMirrorNode) => string,
): { source: string; sourceFrom: number; sourceTo: number } | undefined {
  const temporaryDocument = state.schema.topNodeType.create(null, topLevelNode)
  const relativePosition = textblockContentPosition - topLevelPosition
  const transform = new Transform(temporaryDocument)
  transform.insert(relativePosition, state.schema.text(markerSentinel))

  const withSentinel = trimSerializedBlock(serializer(transform.doc))
  const sentinelPosition = withSentinel.indexOf(markerSentinel)
  if (sentinelPosition < 0) return undefined

  const lineStart = withSentinel.lastIndexOf('\n', sentinelPosition - 1) + 1
  const prefix = withSentinel.slice(lineStart, sentinelPosition)
  const source =
    withSentinel.slice(0, sentinelPosition) +
    withSentinel.slice(sentinelPosition + markerSentinel.length)

  if (!/(?:^|\s)(?:>\s*|[-+*]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/.test(prefix)) {
    return undefined
  }
  return { source, sourceFrom: lineStart, sourceTo: sentinelPosition }
}

function collectContainerMarkers(
  state: EditorState,
  block: TopLevelBlock,
  serializer: (node: ProseMirrorNode) => string,
): SourceMarker[] {
  const markers: SourceMarker[] = []
  block.node.descendants((node, offset) => {
    if (!node.isTextblock || node.type.name === 'code_block') return
    const contentPosition = block.position + offset + 2
    const sourceInfo = sourcePrefixAtTextblock(
      state,
      block.node,
      block.position,
      contentPosition,
      serializer,
    )
    if (!sourceInfo || sourceInfo.sourceFrom === sourceInfo.sourceTo) return
    markers.push({ documentPosition: contentPosition, ...sourceInfo })
  })
  return markers
}

function collectCodeMarkers(
  state: EditorState,
  block: TopLevelBlock,
  serializer: (node: ProseMirrorNode) => string,
): SourceMarker[] {
  const source = serializeTopLevelNode(state, block.node, serializer)
  const firstLineEnd = source.indexOf('\n')
  const lastLineStart = source.lastIndexOf('\n') + 1
  if (firstLineEnd < 0 || lastLineStart <= firstLineEnd) return []

  return [
    {
      documentPosition: block.position,
      selectionPosition: block.position + 1,
      source,
      sourceFrom: 0,
      sourceTo: firstLineEnd,
      className: 'openmd-block-marker openmd-code-fence-marker',
      side: -1,
    },
    {
      documentPosition: block.position + block.node.nodeSize,
      selectionPosition: block.position + block.node.nodeSize - 1,
      source,
      sourceFrom: lastLineStart,
      sourceTo: source.length,
      className: 'openmd-block-marker openmd-code-fence-marker',
      side: 1,
    },
  ]
}

function collectHrMarker(
  state: EditorState,
  block: TopLevelBlock,
  serializer: (node: ProseMirrorNode) => string,
): SourceMarker[] {
  const source = serializeTopLevelNode(state, block.node, serializer)
  return [
    {
      documentPosition: block.position,
      source,
      sourceFrom: 0,
      sourceTo: source.length,
      className: 'openmd-block-marker openmd-hr-marker',
      side: -1,
    },
  ]
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
  const markers = view.dom.querySelectorAll<EditableBlockMarker>(
    `.openmd-block-marker[data-boundary-position="${position}"]`,
  )
  const side = event.key === 'Backspace' ? 'after' : 'before'
  const marker = [...markers].find((candidate) => nativeCaretTouchesMarker(view, candidate, side))
  if (!marker || !marker.textContent) return false

  event.preventDefault()
  if (event.key === 'Backspace') marker.openmdDeleteBackward()
  else marker.openmdDeleteForward()
  return true
}

function startBlockSourceEditing(
  view: EditorView,
  blockPosition: number,
  source: string,
  sourceFrom: number,
  sourceTo: number,
  replacement: string,
  caretInReplacement: number,
): void {
  const originalNode = view.state.doc.nodeAt(blockPosition)
  const codeBlock = view.state.schema.nodes.code_block
  if (!originalNode || !supportedBlockNames.has(originalNode.type.name) || !codeBlock) return

  const nextSource = source.slice(0, sourceFrom) + replacement + source.slice(sourceTo)
  const content = nextSource ? view.state.schema.text(nextSource) : undefined
  const sourceNode = codeBlock.create({ language: '' }, content)
  const transaction = view.state.tr.replaceWith(
    blockPosition,
    blockPosition + originalNode.nodeSize,
    sourceNode,
  )
  transaction.setSelection(
    TextSelection.create(transaction.doc, blockPosition + 1 + sourceFrom + caretInReplacement),
  )
  transaction.setMeta(blockSourceKey, {
    type: 'start-editing',
    position: blockPosition,
    originalNode,
  } satisfies BlockSourceMeta)
  view.dispatch(transaction)
  view.focus()
}

function createEditableMarker(
  view: EditorView,
  blockPosition: number,
  sourceMarker: SourceMarker,
): HTMLElement {
  const widget = document.createElement('span')
  const marker = document.createElement('span')
  const originalMarker = sourceMarker.source.slice(sourceMarker.sourceFrom, sourceMarker.sourceTo)
  marker.className = sourceMarker.className ?? 'openmd-block-marker'
  marker.dataset.boundaryPosition = String(
    sourceMarker.selectionPosition ?? sourceMarker.documentPosition,
  )
  marker.textContent = originalMarker
  marker.contentEditable = String(view.editable)
  marker.tabIndex = -1
  marker.spellcheck = false
  marker.setAttribute('aria-label', 'Markdown 块标记')

  const applyMarker = (nextMarker: string, caretOffset: number): void => {
    if (nextMarker === originalMarker) return
    startBlockSourceEditing(
      view,
      blockPosition,
      sourceMarker.source,
      sourceMarker.sourceFrom,
      sourceMarker.sourceTo,
      nextMarker,
      caretOffset,
    )
  }

  const editableMarker = marker as EditableBlockMarker
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
      const previous = Selection.findFrom(
        view.state.doc.resolve(sourceMarker.documentPosition),
        -1,
        true,
      )
      if (previous) {
        view.dispatch(view.state.tr.setSelection(previous))
        view.focus()
      }
    } else if (
      event.key === 'ArrowRight' &&
      markerSelection.end === (marker.textContent?.length ?? 0)
    ) {
      event.preventDefault()
      const next = Selection.findFrom(
        view.state.doc.resolve(sourceMarker.documentPosition),
        1,
        true,
      )
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
    const sourceNode = state.doc.nodeAt(editingPosition)
    if (!sourceNode || sourceNode.type.name !== 'code_block') return DecorationSet.empty
    return DecorationSet.create(state.doc, [
      Decoration.node(editingPosition, editingPosition + sourceNode.nodeSize, {
        class: 'openmd-block-markdown-source',
        'data-openmd-source': 'true',
      }),
    ])
  }

  const block = topLevelBlockAtSelection(state)
  if (!block || !supportedBlockNames.has(block.node.type.name)) return DecorationSet.empty

  let markers: SourceMarker[] = []
  if (block.node.type.name === 'code_block') {
    markers = collectCodeMarkers(state, block, serializer)
  } else if (block.node.type.name === 'hr') {
    markers = collectHrMarker(state, block, serializer)
  } else {
    markers = collectContainerMarkers(state, block, serializer)
  }
  if (markers.length === 0) return DecorationSet.empty

  const decorations: Decoration[] = [
    Decoration.node(block.position, block.position + block.node.nodeSize, {
      class: `openmd-active-block-source openmd-active-${block.node.type.name}`,
    }),
  ]
  markers.forEach((marker, index) => {
    decorations.push(
      Decoration.widget(
        marker.documentPosition,
        (view) => createEditableMarker(view, block.position, marker),
        {
          key: `block-marker-${block.position}-${marker.documentPosition}-${index}-${marker.source.slice(marker.sourceFrom, marker.sourceTo)}`,
          side: marker.side ?? -1,
          stopEvent: (event) =>
            event.target instanceof Element &&
            event.target.closest('.openmd-block-marker') !== null,
          ignoreSelection: true,
        },
      ),
    )
  })
  return DecorationSet.create(state.doc, decorations)
}

function finishBlockSourceEditing(
  state: EditorState,
  position: number,
  parser: (markdown: string) => ProseMirrorNode,
): Transaction | undefined {
  const sourceNode = state.doc.nodeAt(position)
  if (!sourceNode || sourceNode.type.name !== 'code_block') return undefined

  const parsed = parser(sourceNode.textContent)
  const transaction = state.tr.setMeta(blockSourceKey, {
    type: 'finish-editing',
  } satisfies BlockSourceMeta)
  transaction.replaceWith(position, position + sourceNode.nodeSize, parsed.content)

  if (selectionIsInsideNode(state, position, sourceNode)) {
    const end = Math.min(transaction.doc.content.size, position + parsed.content.size)
    transaction.setSelection(Selection.near(transaction.doc.resolve(end), -1))
  }
  return transaction
}

function cancelBlockSourceEditing(view: EditorView): boolean {
  const pluginState = blockSourceKey.getState(view.state)
  if (pluginState?.editingPosition == null || !pluginState.originalNode) return false
  const sourceNode = view.state.doc.nodeAt(pluginState.editingPosition)
  if (!sourceNode || sourceNode.type.name !== 'code_block') return false

  const transaction = view.state.tr.replaceWith(
    pluginState.editingPosition,
    pluginState.editingPosition + sourceNode.nodeSize,
    pluginState.originalNode,
  )
  transaction.setSelection(
    Selection.near(
      transaction.doc.resolve(
        Math.min(
          transaction.doc.content.size,
          pluginState.editingPosition + pluginState.originalNode.nodeSize,
        ),
      ),
      -1,
    ),
  )
  transaction.setMeta(blockSourceKey, { type: 'cancel-editing' } satisfies BlockSourceMeta)
  transaction.setMeta('addToHistory', false)
  view.dispatch(transaction)
  view.focus()
  return true
}

function syncMarkerEditability(view: EditorView): void {
  view.dom.querySelectorAll<HTMLElement>('.openmd-block-marker').forEach((marker) => {
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

export const blockSourcePlugin = $prose((ctx) => {
  // Parser/serializer slices are populated after prose plugins are registered.
  // Resolve them lazily instead of capturing Milkdown's out-of-scope placeholder.
  const parser = (markdown: string): ProseMirrorNode => ctx.get(parserCtx)(markdown)
  const serializer = (node: ProseMirrorNode): string => ctx.get(serializerCtx)(node)

  return new Plugin<BlockSourceState>({
    key: blockSourceKey,
    state: {
      init: (_, state) => ({
        decorations: createDecorations(state, serializer, null),
        editingPosition: null,
        editingTimestamp: null,
        originalNode: null,
      }),
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(blockSourceKey) as BlockSourceMeta | undefined
        let editingPosition = pluginState.editingPosition
        let editingTimestamp = pluginState.editingTimestamp
        let originalNode = pluginState.originalNode

        if (meta?.type === 'start-editing') {
          editingPosition = meta.position
          editingTimestamp = transaction.time
          originalNode = meta.originalNode
        } else if (meta?.type === 'finish-editing' || meta?.type === 'cancel-editing') {
          editingPosition = null
          editingTimestamp = null
          originalNode = null
        } else if (editingPosition !== null && transaction.docChanged) {
          const mapped = transaction.mapping.mapResult(editingPosition, 1)
          editingPosition = mapped.deleted ? null : mapped.pos
        }

        if (
          editingPosition !== null &&
          newState.doc.nodeAt(editingPosition)?.type.name !== 'code_block'
        ) {
          editingPosition = null
          editingTimestamp = null
          originalNode = null
        }

        return {
          decorations: createDecorations(newState, serializer, editingPosition),
          editingPosition,
          editingTimestamp,
          originalNode,
        }
      },
    },
    filterTransaction: (transaction, state) => {
      const pluginState = blockSourceKey.getState(state)
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
      const editingPosition = blockSourceKey.getState(newState)?.editingPosition
      if (editingPosition == null) return null
      const sourceNode = newState.doc.nodeAt(editingPosition)
      const finishRequested = transactions.some(
        (transaction) =>
          (transaction.getMeta(blockSourceKey) as BlockSourceMeta | undefined)?.type ===
          'request-finish',
      )
      if (
        !finishRequested &&
        sourceNode &&
        sourceNode.type.name === 'code_block' &&
        selectionIsInsideNode(newState, editingPosition, sourceNode)
      ) {
        return null
      }
      return finishBlockSourceEditing(newState, editingPosition, parser) ?? null
    },
    view: (view) => {
      syncMarkerEditability(view)
      const handleFocusOut = (event: FocusEvent): void => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && view.dom.contains(nextTarget)) return

        queueMicrotask(() => {
          const activeElement = view.root.activeElement
          if (activeElement && view.dom.contains(activeElement)) return
          if (!isBlockSourceEditing(view.state)) return
          view.dispatch(
            view.state.tr.setMeta(blockSourceKey, {
              type: 'request-finish',
            } satisfies BlockSourceMeta),
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
      decorations: (state) => blockSourceKey.getState(state)?.decorations,
      handleKeyDown: (view, event) => {
        if (!view.editable || event.isComposing) return false
        if (!isBlockSourceEditing(view.state)) return handleMarkerBoundaryDelete(view, event)
        if (event.key === 'Escape') {
          event.preventDefault()
          return cancelBlockSourceEditing(view)
        }
        if (event.key !== 'Enter' || event.shiftKey) return false

        event.preventDefault()
        view.dispatch(
          view.state.tr.setMeta(blockSourceKey, {
            type: 'request-finish',
          } satisfies BlockSourceMeta),
        )
        insertParagraphAfterCurrentBlock(view)
        return true
      },
      handleClick: (_view, _position, event) => {
        const marker =
          event.target instanceof Element &&
          event.target.closest<HTMLElement>('.openmd-block-marker')
        if (!marker) return false
        marker.focus()
        placeNativeCaret(marker, marker.textContent?.length ?? 0)
        return true
      },
    },
  })
})
