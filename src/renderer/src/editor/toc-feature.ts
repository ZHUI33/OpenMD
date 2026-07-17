import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

import {
  createOutlineFeature,
  type OutlineController,
  type OutlineFeatureOptions,
  type OutlineItem,
} from './outline-feature'

export const TOC_MARKER = '[TOC]'

export interface TocFeatureOptions {
  debounceMs?: number
}

export interface TocPluginState {
  decorations: DecorationSet
}

type TocPluginMeta = { type: 'refresh' }

const DEFAULT_TOC_DEBOUNCE_MS = 180
const tocPluginKey = new PluginKey<TocPluginState>('openmd-dynamic-toc')

/**
 * CommonMark normally escapes `[TOC]` as `\[TOC]`. Override only the exact,
 * plain marker paragraph and delegate every other text node to the configured
 * handler (or the upstream default implementation).
 */
export function configureTocMarkdown(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (options) => {
    const previousTextHandler = options.handlers?.text
    return {
      ...options,
      handlers: {
        ...options.handlers,
        text: (node, parent, state, info) => {
          const isExactMarker =
            node.value === TOC_MARKER &&
            parent?.type === 'paragraph' &&
            parent.children.length === 1 &&
            parent.children[0] === node
          if (isExactMarker) return TOC_MARKER
          return previousTextHandler?.(node, parent, state, info) ?? state.safe(node.value, info)
        },
      },
    }
  })
}

/** A TOC remains an ordinary, unmarked paragraph in the ProseMirror document. */
export function isTocParagraph(node: ProseMirrorNode): boolean {
  const text = node.firstChild
  return (
    node.type.name === 'paragraph' &&
    node.childCount === 1 &&
    text?.isText === true &&
    text.text === TOC_MARKER &&
    text.marks.length === 0
  )
}

export function findTocPositions(documentNode: ProseMirrorNode): number[] {
  const positions: number[] = []
  documentNode.descendants((node, position) => {
    if (isTocParagraph(node)) positions.push(position)
  })
  return positions
}

function createOutlineList(
  ownerDocument: Document,
  items: readonly OutlineItem[],
  activeId: string | null,
  controller: OutlineController,
): HTMLOListElement {
  const list = ownerDocument.createElement('ol')
  list.className = 'openmd-toc-list'
  for (const item of items) {
    const listItem = ownerDocument.createElement('li')
    listItem.className = 'openmd-toc-item'
    listItem.dataset.level = String(item.level)

    const link = ownerDocument.createElement('a')
    link.className = 'openmd-toc-link'
    link.href = `#${encodeURIComponent(item.id)}`
    link.dataset.outlineId = item.id
    link.textContent = item.text || '未命名标题'
    if (item.id === activeId) link.setAttribute('aria-current', 'location')
    link.addEventListener('click', (event) => {
      event.preventDefault()
      controller.scrollToHeading(item.id)
    })
    listItem.appendChild(link)

    if (item.children.length > 0) {
      listItem.appendChild(createOutlineList(ownerDocument, item.children, activeId, controller))
    }
    list.appendChild(listItem)
  }
  return list
}

function createTocNavigation(
  ownerDocument: Document,
  controller: OutlineController,
): { dom: HTMLElement; destroy: () => void } {
  const navigation = ownerDocument.createElement('nav')
  navigation.className = 'openmd-toc'
  navigation.dataset.openmdToc = 'true'
  navigation.contentEditable = 'false'
  navigation.setAttribute('aria-label', '文档目录')

  const render = (): void => {
    const outline = controller.getOutline()
    const title = ownerDocument.createElement('div')
    title.className = 'openmd-toc-title'
    title.textContent = '目录'

    if (outline.length === 0) {
      const empty = ownerDocument.createElement('div')
      empty.className = 'openmd-toc-empty'
      empty.textContent = '暂无标题'
      navigation.replaceChildren(title, empty)
      return
    }

    navigation.replaceChildren(
      title,
      createOutlineList(ownerDocument, outline, controller.getActiveId(), controller),
    )
  }

  const unsubscribeOutline = controller.subscribe(render, false)
  const unsubscribeActive = controller.subscribeActive(render, false)
  render()
  return {
    dom: navigation,
    destroy: () => {
      unsubscribeOutline()
      unsubscribeActive()
    },
  }
}

function createTocDecorations(
  documentNode: ProseMirrorNode,
  controller: OutlineController,
  widgetCleanup: WeakMap<Node, () => void>,
): DecorationSet {
  const decorations: Decoration[] = []
  documentNode.descendants((node, position) => {
    if (!isTocParagraph(node)) return
    decorations.push(
      Decoration.node(position, position + node.nodeSize, {
        class: 'openmd-toc-paragraph',
        'data-openmd-toc': 'true',
      }),
      Decoration.inline(position + 1, position + node.nodeSize - 1, {
        class: 'openmd-toc-marker-text',
        'aria-hidden': 'true',
        style: 'display: none',
      }),
      Decoration.widget(
        position + 1,
        (view) => {
          const mounted = createTocNavigation(view.dom.ownerDocument, controller)
          widgetCleanup.set(mounted.dom, mounted.destroy)
          return mounted.dom
        },
        {
          key: `openmd-toc-${position}`,
          side: -1,
          stopEvent: (event) =>
            event.target instanceof Element && event.target.closest('.openmd-toc') !== null,
          ignoreSelection: true,
          destroy: (dom) => {
            widgetCleanup.get(dom)?.()
            widgetCleanup.delete(dom)
          },
        },
      ),
    )
  })
  return DecorationSet.create(documentNode, decorations)
}

export function createTocProseMirrorPlugin(
  controller: OutlineController,
  options: TocFeatureOptions = {},
): Plugin<TocPluginState> {
  const debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_TOC_DEBOUNCE_MS)
  const widgetCleanup = new WeakMap<Node, () => void>()

  return new Plugin<TocPluginState>({
    key: tocPluginKey,
    state: {
      init: (_, state) => ({
        decorations: createTocDecorations(state.doc, controller, widgetCleanup),
      }),
      apply: (transaction, pluginState) => {
        const meta = transaction.getMeta(tocPluginKey) as TocPluginMeta | undefined
        if (meta?.type === 'refresh') {
          return {
            decorations: createTocDecorations(transaction.doc, controller, widgetCleanup),
          }
        }
        if (transaction.docChanged) {
          return { decorations: pluginState.decorations.map(transaction.mapping, transaction.doc) }
        }
        return pluginState
      },
    },
    props: {
      decorations: (state) => tocPluginKey.getState(state)?.decorations,
    },
    view: (view: EditorView) => {
      const ownerWindow = view.dom.ownerDocument.defaultView ?? window
      let refreshTimer: number | null = null
      let destroyed = false

      const publishRefresh = (): void => {
        refreshTimer = null
        if (destroyed) return
        view.dispatch(
          view.state.tr
            .setMeta(tocPluginKey, { type: 'refresh' } satisfies TocPluginMeta)
            .setMeta('addToHistory', false),
        )
      }

      const scheduleRefresh = (): void => {
        if (refreshTimer !== null) ownerWindow.clearTimeout(refreshTimer)
        refreshTimer = ownerWindow.setTimeout(publishRefresh, debounceMs)
      }

      const unsubscribeOutline = controller.subscribe(() => {
        if (refreshTimer !== null) ownerWindow.clearTimeout(refreshTimer)
        publishRefresh()
      }, false)

      return {
        update: (nextView, previousState) => {
          if (nextView.state.doc !== previousState.doc) scheduleRefresh()
        },
        destroy: () => {
          destroyed = true
          if (refreshTimer !== null) ownerWindow.clearTimeout(refreshTimer)
          refreshTimer = null
          unsubscribeOutline()
        },
      }
    },
  })
}

export function createTocFeature(controller: OutlineController, options: TocFeatureOptions = {}) {
  const proseMirrorPlugin = createTocProseMirrorPlugin(controller, options)
  const tocPlugin = $prose(() => proseMirrorPlugin)
  return {
    configure: configureTocMarkdown,
    tocPlugin,
    proseMirrorPlugin,
    plugins: [tocPlugin],
  }
}

/** One factory for the sidebar outline and every in-document `[TOC]` marker. */
export function createDocumentOutlineFeature(options: OutlineFeatureOptions = {}) {
  const outline = createOutlineFeature(options)
  const toc = createTocFeature(outline.controller, { debounceMs: options.debounceMs })
  return {
    controller: outline.controller,
    configure: toc.configure,
    outlinePlugin: outline.outlinePlugin,
    tocPlugin: toc.tocPlugin,
    proseMirrorPlugins: [outline.proseMirrorPlugin, toc.proseMirrorPlugin],
    plugins: [outline.outlinePlugin, toc.tocPlugin],
  }
}
