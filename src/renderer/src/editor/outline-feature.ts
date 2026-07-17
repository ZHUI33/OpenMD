import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export interface OutlineItem {
  id: string
  level: number
  text: string
  position?: number
  children: OutlineItem[]
}

export interface OutlineHeading {
  level: number
  text: string
  position?: number
}

export interface ScrollToHeadingOptions {
  behavior?: ScrollBehavior
  block?: ScrollLogicalPosition
  focus?: boolean
}

export interface OutlineFeatureOptions {
  debounceMs?: number
  viewportOffset?: number
}

export type OutlineListener = (outline: readonly OutlineItem[]) => void
export type ActiveOutlineListener = (id: string | null) => void

const DEFAULT_OUTLINE_DEBOUNCE_MS = 180
const DEFAULT_VIEWPORT_OFFSET = 16

function normalizedHeadingText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** Creates a readable fragment while keeping CJK and other Unicode letters. */
export function slugifyHeading(text: string): string {
  const slug = normalizedHeadingText(text)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'section'
}

export function flattenOutline(outline: readonly OutlineItem[]): OutlineItem[] {
  const flattened: OutlineItem[] = []
  const visit = (items: readonly OutlineItem[]): void => {
    for (const item of items) {
      flattened.push(item)
      visit(item.children)
    }
  }
  visit(outline)
  return flattened
}

function preferredPreviousIds(
  headings: readonly OutlineHeading[],
  previous: readonly OutlineItem[],
): Array<string | undefined> {
  const oldItems = flattenOutline(previous)
  const oldEntries = oldItems.map((item, index) => ({ item, index }))
  const claimed = new Set<number>()
  const byPosition = new Map<string, typeof oldEntries>()
  const byText = new Map<string, typeof oldEntries>()

  const addToIndex = (
    index: Map<string, typeof oldEntries>,
    key: string,
    entry: (typeof oldEntries)[number],
  ): void => {
    const entries = index.get(key)
    if (entries) entries.push(entry)
    else index.set(key, [entry])
  }
  const positionKey = (level: number, position: number): string => `${level}\u0000${position}`
  const textKey = (level: number, text: string): string =>
    `${level}\u0000${normalizedHeadingText(text)}`

  for (const entry of oldEntries) {
    if (entry.item.position !== undefined) {
      addToIndex(byPosition, positionKey(entry.item.level, entry.item.position), entry)
    }
    addToIndex(byText, textKey(entry.item.level, entry.item.text), entry)
  }

  // Reverse once so pop() consumes each bucket in document order without
  // repeatedly scanning the complete previous outline.
  for (const entries of [...byPosition.values(), ...byText.values()]) entries.reverse()

  const takeAvailable = (
    index: Map<string, typeof oldEntries>,
    key: string,
  ): (typeof oldEntries)[number] | undefined => {
    const entries = index.get(key)
    while (entries?.length) {
      const entry = entries.pop()!
      if (!claimed.has(entry.index)) return entry
    }
    return undefined
  }

  return headings.map((heading, headingIndex) => {
    let match =
      heading.position === undefined
        ? undefined
        : takeAvailable(byPosition, positionKey(heading.level, heading.position))

    if (!match) match = takeAvailable(byText, textKey(heading.level, heading.text))

    if (!match && headings.length === oldItems.length) {
      const sameOrdinal = oldEntries[headingIndex]
      if (
        sameOrdinal &&
        sameOrdinal.item.level === heading.level &&
        !claimed.has(sameOrdinal.index)
      ) {
        match = sameOrdinal
      }
    }

    if (!match) return undefined
    claimed.add(match.index)
    return match.item.id
  })
}

/**
 * Builds a hierarchical H1-H6 outline. Passing the previous tree preserves an
 * existing heading ID across ordinary text edits and position shifts.
 */
export function buildOutlineTree(
  headings: readonly OutlineHeading[],
  previous: readonly OutlineItem[] = [],
): OutlineItem[] {
  const normalized = headings
    .filter(({ level }) => Number.isInteger(level) && level >= 1 && level <= 6)
    .map((heading) => ({
      ...heading,
      text: normalizedHeadingText(heading.text),
    }))
  const preferredIds = preferredPreviousIds(normalized, previous)
  const reservedIds = new Set(preferredIds.filter((id): id is string => Boolean(id)))
  const usedIds = new Set<string>()

  const items = normalized.map<OutlineItem>((heading, index) => {
    const preferredId = preferredIds[index]
    let id = preferredId && !usedIds.has(preferredId) ? preferredId : undefined
    if (!id) {
      const base = slugifyHeading(heading.text)
      id = base
      let occurrence = 2
      while (usedIds.has(id) || reservedIds.has(id)) {
        id = `${base}-${occurrence}`
        occurrence += 1
      }
    }
    usedIds.add(id)
    return {
      id,
      level: heading.level,
      text: heading.text,
      position: heading.position,
      children: [],
    }
  })

  const roots: OutlineItem[] = []
  const ancestors: OutlineItem[] = []
  for (const item of items) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.level >= item.level) {
      ancestors.pop()
    }
    const parent = ancestors[ancestors.length - 1]
    if (parent) parent.children.push(item)
    else roots.push(item)
    ancestors.push(item)
  }
  return roots
}

export function buildDocumentOutline(
  documentNode: ProseMirrorNode,
  previous: readonly OutlineItem[] = [],
): OutlineItem[] {
  const headings: OutlineHeading[] = []
  documentNode.descendants((node, position) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level)
    if (!Number.isInteger(level) || level < 1 || level > 6) return
    headings.push({ level, text: node.textContent, position })
  })
  return buildOutlineTree(headings, previous)
}

export function findOutlineItem(
  outline: readonly OutlineItem[],
  id: string,
): OutlineItem | undefined {
  return flattenOutline(outline).find((item) => item.id === id)
}

export function findActiveHeadingId(
  outline: readonly OutlineItem[],
  documentPosition: number,
): string | null {
  let active: OutlineItem | undefined
  for (const item of flattenOutline(outline)) {
    if (item.position === undefined || item.position > documentPosition) continue
    if (active?.position === undefined || item.position >= active.position) active = item
  }
  return active?.id ?? null
}

function elementAtHeading(view: EditorView, position: number): HTMLElement | null {
  const node = view.nodeDOM(position)
  if (node instanceof HTMLElement) return node
  return node?.parentElement ?? null
}

export function findActiveHeadingFromViewport(
  view: EditorView,
  outline: readonly OutlineItem[],
  viewportOffset = DEFAULT_VIEWPORT_OFFSET,
): string | null {
  let nearestBefore: OutlineItem | undefined
  let firstAfter: OutlineItem | undefined
  for (const item of flattenOutline(outline)) {
    if (item.position === undefined) continue
    const element = elementAtHeading(view, item.position)
    if (!element) continue
    const top = element.getBoundingClientRect().top
    if (top <= viewportOffset) nearestBefore = item
    else if (!firstAfter) firstAfter = item
  }
  return nearestBefore?.id ?? firstAfter?.id ?? null
}

function outlineEquals(left: readonly OutlineItem[], right: readonly OutlineItem[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      item.id === other.id &&
      item.level === other.level &&
      item.text === other.text &&
      item.position === other.position &&
      outlineEquals(item.children, other.children)
    )
  })
}

export class OutlineController {
  private outline: OutlineItem[] = []
  private activeId: string | null = null
  private view: EditorView | null = null
  private readonly outlineListeners = new Set<OutlineListener>()
  private readonly activeListeners = new Set<ActiveOutlineListener>()

  getOutline(): readonly OutlineItem[] {
    return this.outline
  }

  getActiveId(): string | null {
    return this.activeId
  }

  subscribe(listener: OutlineListener, emitCurrent = true): () => void {
    this.outlineListeners.add(listener)
    if (emitCurrent) listener(this.outline)
    return () => this.outlineListeners.delete(listener)
  }

  subscribeActive(listener: ActiveOutlineListener, emitCurrent = true): () => void {
    this.activeListeners.add(listener)
    if (emitCurrent) listener(this.activeId)
    return () => this.activeListeners.delete(listener)
  }

  scrollToHeading(id: string, options: ScrollToHeadingOptions = {}): boolean {
    const view = this.view
    const item = findOutlineItem(this.outline, id)
    if (!view || item?.position === undefined) return false
    const node = view.state.doc.nodeAt(item.position)
    if (node?.type.name !== 'heading') return false

    const element = elementAtHeading(view, item.position)
    element?.scrollIntoView?.({
      behavior: options.behavior ?? 'smooth',
      block: options.block ?? 'start',
    })

    if (options.focus ?? true) {
      const selectionPosition = Math.min(view.state.doc.content.size, item.position + 1)
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, selectionPosition))
          .scrollIntoView(),
      )
      view.focus()
    }
    this.setActiveId(id)
    return true
  }

  refreshActiveHeading(viewportOffset = DEFAULT_VIEWPORT_OFFSET): string | null {
    if (!this.view) return this.activeId
    const id = findActiveHeadingFromViewport(this.view, this.outline, viewportOffset)
    this.setActiveId(id)
    return id
  }

  /** @internal Used by the ProseMirror plugin. */
  attach(view: EditorView): void {
    this.view = view
  }

  /** @internal Used by the ProseMirror plugin. */
  detach(view: EditorView): boolean {
    if (this.view !== view) return false
    this.view = null
    return true
  }

  /** @internal Rebuilds and publishes one debounced snapshot. */
  rebuild(documentNode: ProseMirrorNode): readonly OutlineItem[] {
    const next = buildDocumentOutline(documentNode, this.outline)
    if (outlineEquals(this.outline, next)) return this.outline
    this.outline = next
    for (const listener of this.outlineListeners) listener(this.outline)
    return this.outline
  }

  /** @internal Synchronizes selection/viewport state. */
  setActiveId(id: string | null): void {
    if (id === this.activeId) return
    this.activeId = id
    for (const listener of this.activeListeners) listener(id)
  }

  /** @internal Clears document-specific state when the editor is destroyed. */
  clear(): void {
    const hadOutline = this.outline.length > 0
    const hadActive = this.activeId !== null
    this.outline = []
    this.activeId = null
    if (hadOutline) for (const listener of this.outlineListeners) listener(this.outline)
    if (hadActive) for (const listener of this.activeListeners) listener(null)
  }
}

export interface OutlinePluginState {
  decorations: DecorationSet
}

type OutlinePluginMeta =
  | { type: 'outline-rebuilt' }
  | { type: 'viewport-active'; id: string | null }

const outlinePluginKey = new PluginKey<OutlinePluginState>('openmd-document-outline')

function createHeadingDecorations(
  state: EditorState,
  outline: readonly OutlineItem[],
  activeId: string | null,
): DecorationSet {
  const decorations: Decoration[] = []
  for (const item of flattenOutline(outline)) {
    if (item.position === undefined) continue
    const heading = state.doc.nodeAt(item.position)
    if (heading?.type.name !== 'heading') continue
    decorations.push(
      Decoration.node(item.position, item.position + heading.nodeSize, {
        id: item.id,
        'data-openmd-outline-id': item.id,
        class: item.id === activeId ? 'openmd-current-heading' : '',
      }),
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

function scrollContainer(element: HTMLElement): HTMLElement | Window {
  const ownerWindow = element.ownerDocument.defaultView
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = ownerWindow?.getComputedStyle(parent)
    if (style && /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)) {
      return parent
    }
  }
  return ownerWindow ?? window
}

export function createOutlineProseMirrorPlugin(
  controller: OutlineController,
  options: OutlineFeatureOptions = {},
): Plugin<OutlinePluginState> {
  const debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_OUTLINE_DEBOUNCE_MS)
  const viewportOffset = options.viewportOffset ?? DEFAULT_VIEWPORT_OFFSET

  return new Plugin<OutlinePluginState>({
    key: outlinePluginKey,
    state: {
      init: (_, state) => {
        const outline = controller.rebuild(state.doc)
        const activeId = findActiveHeadingId(outline, state.selection.from)
        controller.setActiveId(activeId)
        return { decorations: createHeadingDecorations(state, outline, activeId) }
      },
      apply: (transaction, pluginState, _oldState, newState) => {
        const meta = transaction.getMeta(outlinePluginKey) as OutlinePluginMeta | undefined
        if (meta?.type === 'viewport-active') controller.setActiveId(meta.id)
        else if (meta?.type === 'outline-rebuilt' || transaction.selectionSet) {
          controller.setActiveId(
            findActiveHeadingId(controller.getOutline(), newState.selection.from),
          )
        }

        if (meta || (transaction.selectionSet && !transaction.docChanged)) {
          return {
            decorations: createHeadingDecorations(
              newState,
              controller.getOutline(),
              controller.getActiveId(),
            ),
          }
        }
        if (transaction.docChanged) {
          return { decorations: pluginState.decorations.map(transaction.mapping, transaction.doc) }
        }
        return pluginState
      },
    },
    props: {
      decorations: (state) => outlinePluginKey.getState(state)?.decorations,
    },
    view: (view) => {
      controller.attach(view)
      const ownerWindow = view.dom.ownerDocument.defaultView ?? window
      const scrollingElement = scrollContainer(view.dom)
      let rebuildTimer: number | null = null
      let cancelPendingFrame: (() => void) | null = null
      let destroyed = false

      const publishRebuild = (): void => {
        rebuildTimer = null
        if (destroyed) return
        controller.rebuild(view.state.doc)
        controller.setActiveId(
          findActiveHeadingId(controller.getOutline(), view.state.selection.from),
        )
        view.dispatch(
          view.state.tr
            .setMeta(outlinePluginKey, { type: 'outline-rebuilt' } satisfies OutlinePluginMeta)
            .setMeta('addToHistory', false),
        )
      }

      const scheduleRebuild = (): void => {
        if (rebuildTimer !== null) ownerWindow.clearTimeout(rebuildTimer)
        rebuildTimer = ownerWindow.setTimeout(publishRebuild, debounceMs)
      }

      const publishViewportActive = (): void => {
        cancelPendingFrame = null
        if (destroyed) return
        const id = findActiveHeadingFromViewport(view, controller.getOutline(), viewportOffset)
        if (id === controller.getActiveId()) return
        controller.setActiveId(id)
        view.dispatch(
          view.state.tr
            .setMeta(outlinePluginKey, {
              type: 'viewport-active',
              id,
            } satisfies OutlinePluginMeta)
            .setMeta('addToHistory', false),
        )
      }

      const scheduleViewportActive = (): void => {
        if (cancelPendingFrame) return
        if (ownerWindow.requestAnimationFrame) {
          const frame = ownerWindow.requestAnimationFrame(publishViewportActive)
          cancelPendingFrame = () => ownerWindow.cancelAnimationFrame(frame)
        } else {
          const timer = ownerWindow.setTimeout(publishViewportActive, 16)
          cancelPendingFrame = () => ownerWindow.clearTimeout(timer)
        }
      }

      scrollingElement.addEventListener('scroll', scheduleViewportActive, { passive: true })
      // Milkdown can create the ProseMirror view before applying `defaultValue`.
      // Rebuild once the current setup stack completes so the initial outline
      // and heading decorations always reflect the opened Markdown document.
      queueMicrotask(publishRebuild)
      return {
        update: (nextView, previousState) => {
          if (nextView.state.doc !== previousState.doc) scheduleRebuild()
        },
        destroy: () => {
          destroyed = true
          if (rebuildTimer !== null) ownerWindow.clearTimeout(rebuildTimer)
          cancelPendingFrame?.()
          rebuildTimer = null
          cancelPendingFrame = null
          scrollingElement.removeEventListener('scroll', scheduleViewportActive)
          if (controller.detach(view)) controller.clear()
        },
      }
    },
  })
}

export function createOutlineFeature(options: OutlineFeatureOptions = {}) {
  const controller = new OutlineController()
  const proseMirrorPlugin = createOutlineProseMirrorPlugin(controller, options)
  const outlinePlugin = $prose(() => proseMirrorPlugin)

  return {
    controller,
    outlinePlugin,
    proseMirrorPlugin,
    plugins: [outlinePlugin],
  }
}
