import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

import type { DocumentSearchQuery, DocumentSearchStatus } from './editor.types'

export interface DocumentSearchMatch {
  from: number
  to: number
  replacement: string
}

interface SearchPluginState {
  query: DocumentSearchQuery
  matches: DocumentSearchMatch[]
  currentIndex: number
  decorations: DecorationSet
  error?: string
}

type SearchPluginMeta =
  | { type: 'query'; query: DocumentSearchQuery }
  | { type: 'select'; index: number }
  | { type: 'refresh'; preferredFrom: number }

const EMPTY_QUERY: DocumentSearchQuery = {
  query: '',
  replacement: '',
  caseSensitive: false,
  wholeWord: false,
  regularExpression: false,
}

export const documentSearchPluginKey = new PluginKey<SearchPluginState>('openmd-document-search')

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function createRegularExpression(query: DocumentSearchQuery, global: boolean): RegExp {
  const source = query.regularExpression ? query.query : escapeRegularExpression(query.query)
  const wrapped = query.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source
  return new RegExp(wrapped, `${global ? 'g' : ''}${query.caseSensitive ? '' : 'i'}u`)
}

interface FlattenedDocument {
  text: string
  fromByIndex: number[]
  toByIndex: number[]
}

function flattenDocument(documentNode: ProseMirrorNode): FlattenedDocument {
  let text = ''
  const fromByIndex: number[] = []
  const toByIndex: number[] = []
  let previousEnd: number | undefined

  documentNode.descendants((node, position) => {
    if (!node.isText || !node.text) return true
    if (previousEnd !== undefined && position !== previousEnd) {
      text += '\n'
      fromByIndex.push(position)
      toByIndex.push(position)
    }
    for (let index = 0; index < node.text.length; index += 1) {
      text += node.text[index]
      fromByIndex.push(position + index)
      toByIndex.push(position + index + 1)
    }
    previousEnd = position + node.nodeSize
    return false
  })
  return { text, fromByIndex, toByIndex }
}

export function findDocumentSearchMatches(
  documentNode: ProseMirrorNode,
  query: DocumentSearchQuery,
): { matches: DocumentSearchMatch[]; error?: string } {
  if (!query.query) return { matches: [] }
  let expression: RegExp
  let replacementExpression: RegExp
  try {
    expression = createRegularExpression(query, true)
    replacementExpression = createRegularExpression(query, false)
  } catch (error) {
    return {
      matches: [],
      error: error instanceof Error ? error.message : '正则表达式无效。',
    }
  }

  const flattened = flattenDocument(documentNode)
  const matches: DocumentSearchMatch[] = []
  for (const match of flattened.text.matchAll(expression)) {
    const start = match.index
    const end = start + match[0].length
    if (end <= start || flattened.fromByIndex[start] === undefined) continue
    const from = flattened.fromByIndex[start]
    const to = flattened.toByIndex[end - 1]
    if (from === undefined || to === undefined || to <= from) continue
    matches.push({
      from,
      to,
      replacement: match[0].replace(replacementExpression, query.replacement),
    })
  }
  return { matches }
}

function currentIndexNear(
  matches: readonly DocumentSearchMatch[],
  position: number,
  exactSelection?: { from: number; to: number },
): number {
  if (matches.length === 0) return -1
  if (exactSelection) {
    const exact = matches.findIndex(
      (match) => match.from === exactSelection.from && match.to === exactSelection.to,
    )
    if (exact >= 0) return exact
  }
  const after = matches.findIndex((match) => match.from >= position)
  return after >= 0 ? after : 0
}

function createDecorations(
  documentNode: ProseMirrorNode,
  matches: readonly DocumentSearchMatch[],
  currentIndex: number,
): DecorationSet {
  return DecorationSet.create(
    documentNode,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === currentIndex
            ? 'openmd-search-match openmd-search-match--current'
            : 'openmd-search-match',
        'data-openmd-search-match': index === currentIndex ? 'current' : 'match',
      }),
    ),
  )
}

function buildState(
  state: EditorState,
  query: DocumentSearchQuery,
  preferredFrom = state.selection.from,
  exactSelection = { from: state.selection.from, to: state.selection.to },
): SearchPluginState {
  const result = findDocumentSearchMatches(state.doc, query)
  const currentIndex = currentIndexNear(result.matches, preferredFrom, exactSelection)
  return {
    query,
    matches: result.matches,
    currentIndex,
    decorations: createDecorations(state.doc, result.matches, currentIndex),
    error: result.error,
  }
}

function replaceRange(
  transaction: Transaction,
  state: EditorState,
  match: DocumentSearchMatch,
): Transaction {
  if (!match.replacement) return transaction.delete(match.from, match.to)
  const marks =
    state.doc.resolve(match.from).nodeAfter?.marks ??
    state.doc.resolve(match.from).marksAcross(state.doc.resolve(match.to)) ??
    []
  return transaction.replaceWith(match.from, match.to, state.schema.text(match.replacement, marks))
}

export class DocumentSearchController {
  private view?: EditorView
  private lastStatus: DocumentSearchStatus = { current: 0, total: 0 }

  constructor(private readonly onStatusChange?: (status: DocumentSearchStatus) => void) {}

  attach(view: EditorView): void {
    this.view = view
    this.publish()
  }

  detach(view: EditorView): void {
    if (this.view === view) this.view = undefined
  }

  setQuery(query: DocumentSearchQuery): void {
    const view = this.view
    if (!view) return
    view.dispatch(
      view.state.tr
        .setMeta(documentSearchPluginKey, { type: 'query', query } satisfies SearchPluginMeta)
        .setMeta('addToHistory', false),
    )
  }

  clear(): void {
    this.setQuery(EMPTY_QUERY)
  }

  next(direction: 1 | -1 = 1): void {
    const view = this.view
    if (!view) return
    const pluginState = documentSearchPluginKey.getState(view.state)
    if (!pluginState || pluginState.matches.length === 0) return
    const currentIndex =
      (pluginState.currentIndex + direction + pluginState.matches.length) %
      pluginState.matches.length
    const match = pluginState.matches[currentIndex]!
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, match.from, match.to))
        .setMeta(documentSearchPluginKey, {
          type: 'select',
          index: currentIndex,
        } satisfies SearchPluginMeta)
        .scrollIntoView(),
    )
  }

  replaceCurrent(): void {
    const view = this.view
    if (!view) return
    const pluginState = documentSearchPluginKey.getState(view.state)
    const match = pluginState?.matches[pluginState.currentIndex]
    if (!pluginState || !match) return
    const transaction = replaceRange(view.state.tr, view.state, match).setMeta(
      documentSearchPluginKey,
      { type: 'refresh', preferredFrom: match.from } satisfies SearchPluginMeta,
    )
    view.dispatch(transaction)
  }

  replaceAll(): void {
    const view = this.view
    if (!view) return
    const pluginState = documentSearchPluginKey.getState(view.state)
    if (!pluginState || pluginState.matches.length === 0) return
    let transaction = view.state.tr
    for (const match of [...pluginState.matches].reverse()) {
      transaction = replaceRange(transaction, view.state, match)
    }
    view.dispatch(
      transaction.setMeta(documentSearchPluginKey, {
        type: 'refresh',
        preferredFrom: pluginState.matches[0]!.from,
      } satisfies SearchPluginMeta),
    )
  }

  publish(): void {
    const state = this.view ? documentSearchPluginKey.getState(this.view.state) : undefined
    const status: DocumentSearchStatus = {
      current: state && state.currentIndex >= 0 ? state.currentIndex + 1 : 0,
      total: state?.matches.length ?? 0,
      error: state?.error,
    }
    if (
      status.current === this.lastStatus.current &&
      status.total === this.lastStatus.total &&
      status.error === this.lastStatus.error
    ) {
      return
    }
    this.lastStatus = status
    this.onStatusChange?.(status)
  }
}

export function createDocumentSearchFeature(
  onStatusChange?: (status: DocumentSearchStatus) => void,
) {
  const controller = new DocumentSearchController(onStatusChange)
  const proseMirrorPlugin = new Plugin<SearchPluginState>({
    key: documentSearchPluginKey,
    state: {
      init: (_, state) => buildState(state, EMPTY_QUERY),
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(documentSearchPluginKey) as SearchPluginMeta | undefined
        if (meta?.type === 'query') return buildState(newState, meta.query)
        if (meta?.type === 'refresh') {
          return buildState(newState, pluginState.query, meta.preferredFrom)
        }
        if (transaction.docChanged) {
          return buildState(newState, pluginState.query, transaction.selection.from)
        }
        if (meta?.type === 'select') {
          return {
            ...pluginState,
            currentIndex: meta.index,
            decorations: createDecorations(newState.doc, pluginState.matches, meta.index),
          }
        }
        return pluginState
      },
    },
    props: {
      decorations: (state) => documentSearchPluginKey.getState(state)?.decorations,
    },
    view: (view) => {
      controller.attach(view)
      return {
        update: () => controller.publish(),
        destroy: () => controller.detach(view),
      }
    },
  })
  return {
    controller,
    proseMirrorPlugin,
    plugin: $prose(() => proseMirrorPlugin),
  }
}
