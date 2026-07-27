import type { Editor } from '@milkdown/kit/core'
import {
  linkSchema,
  remarkHtmlTransformer,
  remarkInlineLinkPlugin,
} from '@milkdown/kit/preset/commonmark'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import type { MarkdownNode, SerializerState } from '@milkdown/kit/transformer'
import { $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import remarkFrontmatter from 'remark-frontmatter'

export type MarkdownAlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'

interface ParentMarkdownNode extends MarkdownNode {
  children: MarkdownNode[]
}

interface ReferenceDefinition {
  identifier: string
  label: string
  title: string | null
  url: string
}

interface SourceRange {
  end: number
  start: number
  value: string
}

function isParentMarkdownNode(node: MarkdownNode): node is ParentMarkdownNode {
  return Array.isArray(node.children)
}

function markdownNodeOffsets(node: MarkdownNode): { end: number; start: number } | null {
  const position = Reflect.get(node, 'position')
  if (!position || typeof position !== 'object') return null
  const start = Reflect.get(Reflect.get(position, 'start') ?? {}, 'offset')
  const end = Reflect.get(Reflect.get(position, 'end') ?? {}, 'offset')
  return typeof start === 'number' && typeof end === 'number' ? { end, start } : null
}

function unsupportedContainerRanges(source: string): SourceRange[] {
  const lines: Array<{ content: string; end: number; start: number }> = []
  let start = 0
  while (start < source.length) {
    const match = /\r\n|\r|\n/gu.exec(source.slice(start))
    const contentEnd = match ? start + match.index : source.length
    const end = match ? contentEnd + match[0].length : source.length
    lines.push({ content: source.slice(start, contentEnd), end, start })
    start = end
  }

  const ranges: SourceRange[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]!.content.match(/^ {0,3}(:{3,})(.*)$/u)
    if (!opening || opening[2]?.trim() === '') continue

    for (let closingIndex = index + 1; closingIndex < lines.length; closingIndex += 1) {
      const closing = lines[closingIndex]!
      const closingMarker = closing.content.match(/^ {0,3}(:{3,})\s*$/u)?.[1]
      if (!closingMarker || closingMarker.length < opening[1]!.length) continue
      const rangeEnd = closing.start + closing.content.length
      ranges.push({
        start: lines[index]!.start,
        end: rangeEnd,
        value: source.slice(lines[index]!.start, rangeEnd),
      })
      index = closingIndex
      break
    }
  }
  return ranges
}

/**
 * CommonMark treats extension containers such as `:::custom` as ordinary
 * paragraphs. Turning those paragraphs into rich nodes would lose the
 * extension boundary on the next edit, so keep the complete source range as a
 * single editable raw block until OpenMD gains a dedicated implementation.
 */
function protectUnsupportedBlocks(tree: MarkdownNode, source: string): void {
  if (tree.type !== 'root' || !isParentMarkdownNode(tree)) return
  const ranges = unsupportedContainerRanges(source)
  if (ranges.length === 0) return

  const output: MarkdownNode[] = []
  let childIndex = 0
  for (const range of ranges) {
    while (childIndex < tree.children.length) {
      const offsets = markdownNodeOffsets(tree.children[childIndex]!)
      if (!offsets || offsets.end > range.start) break
      output.push(tree.children[childIndex]!)
      childIndex += 1
    }

    output.push({
      type: 'openmdRawBlock',
      value: range.value,
    } as MarkdownNode)
    while (childIndex < tree.children.length) {
      const offsets = markdownNodeOffsets(tree.children[childIndex]!)
      if (!offsets || offsets.start >= range.end) break
      childIndex += 1
    }
  }
  output.push(...tree.children.slice(childIndex))
  tree.children = output
}

function safeVisualHref(value: unknown): string {
  const href = typeof value === 'string' ? value.trim() : ''
  if (!href) return ''
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/iu)?.[1]?.toLocaleLowerCase('en-US')
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return '#'
  // micromark's GFM autolink parser keeps non-ASCII punctuation in a bare
  // link. It remains part of the Markdown text, but should not become part of
  // the destination users open from the visual editor.
  return scheme === 'http' || scheme === 'https' ? href.replace(/[、。，；：！？]+$/gu, '') : href
}

function referenceDefinitionText(definition: ReferenceDefinition): string {
  const title = definition.title ? ` "${definition.title.replaceAll('"', '\\"')}"` : ''
  return `[${definition.label || definition.identifier}]: ${definition.url}${title}`
}

function transformMarkdownCompatibilityTree(tree: MarkdownNode): void {
  const definitions = new Map<string, ReferenceDefinition>()

  const collectDefinitions = (node: MarkdownNode): void => {
    if (node.type === 'definition') {
      const identifier = String(node.identifier ?? '').toLocaleLowerCase('en-US')
      definitions.set(identifier, {
        identifier: String(node.identifier ?? ''),
        label: String(node.label ?? node.identifier ?? ''),
        title: typeof node.title === 'string' ? node.title : null,
        url: String(node.url ?? ''),
      })
    }
    if (isParentMarkdownNode(node)) node.children.forEach(collectDefinitions)
  }
  collectDefinitions(tree)

  const transform = (node: MarkdownNode, parent?: MarkdownNode): void => {
    if (isParentMarkdownNode(node)) node.children.forEach((child) => transform(child, node))

    if (
      node.type === 'html' &&
      parent &&
      ['root', 'blockquote', 'listItem'].includes(parent.type)
    ) {
      node.type = 'openmdHtmlBlock'
      return
    }

    if (node.type === 'linkReference' || node.type === 'imageReference') {
      const identifier = String(node.identifier ?? '').toLocaleLowerCase('en-US')
      const definition = definitions.get(identifier)
      node.data = {
        ...(typeof node.data === 'object' && node.data ? node.data : {}),
        openmdDefinitionTitle: definition?.title ?? null,
        openmdDefinitionUrl: definition?.url ?? '',
      }
      return
    }

    if (node.type !== 'blockquote' || !isParentMarkdownNode(node)) return
    const firstParagraph = node.children[0]
    if (
      !firstParagraph ||
      firstParagraph.type !== 'paragraph' ||
      !isParentMarkdownNode(firstParagraph)
    ) {
      return
    }
    const marker = firstParagraph.children[0]
    if (!marker || marker.type !== 'text' || typeof marker.value !== 'string') return
    const match = marker.value.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*)$/u)
    if (!match) return

    firstParagraph.children.shift()
    const possibleInlineBreak = firstParagraph.children[0]
    if (
      possibleInlineBreak?.type === 'break' &&
      typeof possibleInlineBreak.data === 'object' &&
      possibleInlineBreak.data &&
      Reflect.get(possibleInlineBreak.data, 'isInline') === true
    ) {
      firstParagraph.children.shift()
    }
    if (firstParagraph.children.length === 0) node.children.shift()
    if (node.children.length === 0) {
      node.children.push({ type: 'paragraph', children: [] } as MarkdownNode)
    }
    node.type = 'openmdAlert'
    node.alertType = match[1]
  }
  transform(tree)
}

const frontmatterRemarkPlugin = $remark('openmdFrontmatter', () => remarkFrontmatter, 'yaml')

const compatibilityTransformRemarkPlugin = $remark(
  'openmdCompatibilityTransform',
  () => () => (tree, file) => {
    protectUnsupportedBlocks(
      tree as unknown as MarkdownNode,
      typeof file.value === 'string' ? file.value : String(file.value ?? ''),
    )
    transformMarkdownCompatibilityTree(tree as unknown as MarkdownNode)
    return tree
  },
)

const frontmatterSchema = $nodeSchema('front_matter', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'aside[data-openmd-frontmatter]',
      getAttrs: (element) => ({
        value: element instanceof HTMLElement ? (element.dataset.value ?? '') : '',
      }),
    },
  ],
  toDOM: (node) => [
    'aside',
    {
      'data-openmd-frontmatter': 'true',
      'data-value': node.attrs.value,
      class: 'openmd-frontmatter',
    },
    ['div', { class: 'openmd-frontmatter__label' }, 'YAML Front Matter'],
    ['pre', { class: 'openmd-frontmatter__fallback' }, node.attrs.value],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => state.addNode(type, { value: String(node.value ?? '') }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'front_matter',
    runner: (state, node) => state.addNode('yaml', undefined, String(node.attrs.value ?? '')),
  },
}))

const rawHtmlBlockSchema = $nodeSchema('raw_html_block', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'aside[data-openmd-raw-html]',
      getAttrs: (element) => ({
        value: element instanceof HTMLElement ? (element.dataset.value ?? '') : '',
      }),
    },
  ],
  toDOM: (node) => [
    'aside',
    {
      'data-openmd-raw-html': 'true',
      'data-value': node.attrs.value,
      class: 'openmd-raw-markdown openmd-raw-html',
    },
    ['div', { class: 'openmd-raw-markdown__label' }, '原始 HTML（不会执行）'],
    ['pre', { class: 'openmd-raw-markdown__fallback' }, node.attrs.value],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'openmdHtmlBlock',
    runner: (state, node, type) => state.addNode(type, { value: String(node.value ?? '') }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'raw_html_block',
    runner: (state, node) => state.addNode('html', undefined, String(node.attrs.value ?? '')),
  },
}))

const rawMarkdownBlockSchema = $nodeSchema('raw_markdown_block', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  defining: true,
  attrs: {
    value: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'aside[data-openmd-raw-markdown]',
      getAttrs: (element) => ({
        value: element instanceof HTMLElement ? (element.dataset.value ?? '') : '',
      }),
    },
  ],
  toDOM: (node) => [
    'aside',
    {
      'data-openmd-raw-markdown': 'true',
      'data-value': node.attrs.value,
      class: 'openmd-raw-markdown openmd-raw-unsupported',
    },
    ['div', { class: 'openmd-raw-markdown__label' }, '暂不支持的 Markdown（按源码保留）'],
    ['pre', { class: 'openmd-raw-markdown__fallback' }, node.attrs.value],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'openmdRawBlock',
    runner: (state, node, type) => state.addNode(type, { value: String(node.value ?? '') }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'raw_markdown_block',
    runner: (state, node) => state.addNode('html', undefined, String(node.attrs.value ?? '')),
  },
}))

const alertSchema = $nodeSchema('markdown_alert', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: {
    alertType: { default: 'NOTE', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'aside[data-openmd-alert]',
      getAttrs: (element) => ({
        alertType:
          element instanceof HTMLElement ? (element.dataset.openmdAlert ?? 'NOTE') : 'NOTE',
      }),
      contentElement: '.openmd-alert__content',
    },
  ],
  toDOM: (node) => {
    const alertType = String(node.attrs.alertType ?? 'NOTE').toUpperCase()
    return [
      'aside',
      {
        class: `openmd-alert openmd-alert--${alertType.toLocaleLowerCase('en-US')}`,
        'data-openmd-alert': alertType,
      },
      ['div', { class: 'openmd-alert__title', contenteditable: 'false' }, alertType],
      ['div', { class: 'openmd-alert__content' }, 0],
    ]
  },
  parseMarkdown: {
    match: (node) => node.type === 'openmdAlert',
    runner: (state, node, type) =>
      state
        .openNode(type, { alertType: String(node.alertType ?? 'NOTE') })
        .next(node.children ?? [])
        .closeNode(),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'markdown_alert',
    runner: (state, node) => serializeAlert(state, node),
  },
}))

function serializeAlert(state: SerializerState, node: ProseMirrorNode): void {
  const alertType = String(node.attrs.alertType ?? 'NOTE').toUpperCase()
  const firstBlock = node.firstChild
  state.openNode('blockquote')
  if (firstBlock?.type.name === 'paragraph') {
    state.openNode('paragraph')
    state.addNode('text', undefined, `[!${alertType}]`)
    state.addNode('break')
    state.next(firstBlock.content)
    state.closeNode()
    for (let index = 1; index < node.childCount; index += 1) state.next(node.child(index))
  } else {
    state.openNode('paragraph').addNode('text', undefined, `[!${alertType}]`).closeNode()
    state.next(node.content)
  }
  state.closeNode()
}

const referenceDefinitionSchema = $nodeSchema('reference_definition', () => ({
  group: 'block',
  atom: true,
  defining: true,
  attrs: {
    identifier: { default: '', validate: 'string' },
    label: { default: '', validate: 'string' },
    title: { default: null, validate: 'string|null' },
    url: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'div[data-openmd-reference-definition]',
      getAttrs: (element) => {
        if (!(element instanceof HTMLElement)) return false
        return {
          identifier: element.dataset.identifier ?? '',
          label: element.dataset.label ?? '',
          title: element.dataset.title || null,
          url: element.dataset.url ?? '',
        }
      },
    },
  ],
  toDOM: (node) => {
    const definition: ReferenceDefinition = {
      identifier: String(node.attrs.identifier ?? ''),
      label: String(node.attrs.label ?? ''),
      title: typeof node.attrs.title === 'string' ? node.attrs.title : null,
      url: String(node.attrs.url ?? ''),
    }
    return [
      'div',
      {
        class: 'openmd-reference-definition',
        'data-openmd-reference-definition': 'true',
        'data-identifier': definition.identifier,
        'data-label': definition.label,
        'data-title': definition.title ?? '',
        'data-url': definition.url,
        contenteditable: 'false',
      },
      ['code', {}, referenceDefinitionText(definition)],
    ]
  },
  parseMarkdown: {
    match: (node) => node.type === 'definition',
    runner: (state, node, type) =>
      state.addNode(type, {
        identifier: String(node.identifier ?? ''),
        label: String(node.label ?? node.identifier ?? ''),
        title: typeof node.title === 'string' ? node.title : null,
        url: String(node.url ?? ''),
      }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'reference_definition',
    runner: (state, node) =>
      state.addNode('definition', undefined, undefined, {
        identifier: String(node.attrs.identifier ?? ''),
        label: String(node.attrs.label ?? node.attrs.identifier ?? ''),
        title: typeof node.attrs.title === 'string' ? node.attrs.title : null,
        url: String(node.attrs.url ?? ''),
      }),
  },
}))

const linkReferenceSchema = $nodeSchema('link_reference', () => ({
  inline: true,
  group: 'inline',
  content: 'inline*',
  attrs: {
    identifier: { default: '', validate: 'string' },
    label: { default: '', validate: 'string' },
    referenceType: { default: 'full', validate: 'string' },
    resolvedTitle: { default: null, validate: 'string|null' },
    resolvedUrl: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'a[data-openmd-link-reference]',
      getAttrs: (element) => {
        if (!(element instanceof HTMLElement)) return false
        return {
          identifier: element.dataset.identifier ?? '',
          label: element.dataset.label ?? '',
          referenceType: element.dataset.referenceType ?? 'full',
          resolvedTitle: element.dataset.resolvedTitle || null,
          resolvedUrl: element.dataset.resolvedUrl ?? '',
        }
      },
    },
  ],
  toDOM: (node) => [
    'a',
    {
      href: safeVisualHref(node.attrs.resolvedUrl),
      title: node.attrs.resolvedTitle,
      'data-openmd-link-reference': 'true',
      'data-identifier': node.attrs.identifier,
      'data-label': node.attrs.label,
      'data-reference-type': node.attrs.referenceType,
      'data-resolved-title': node.attrs.resolvedTitle ?? '',
      'data-resolved-url': node.attrs.resolvedUrl,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'linkReference',
    runner: (state, node, type) =>
      state
        .openNode(type, {
          identifier: String(node.identifier ?? ''),
          label: String(node.label ?? node.identifier ?? ''),
          referenceType: String(node.referenceType ?? 'full'),
          resolvedTitle:
            typeof Reflect.get(node.data ?? {}, 'openmdDefinitionTitle') === 'string'
              ? String(Reflect.get(node.data ?? {}, 'openmdDefinitionTitle'))
              : null,
          resolvedUrl: String(Reflect.get(node.data ?? {}, 'openmdDefinitionUrl') ?? ''),
        })
        .next(node.children ?? [])
        .closeNode(),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'link_reference',
    runner: (state, node) =>
      state
        .openNode('linkReference', undefined, {
          identifier: String(node.attrs.identifier ?? ''),
          label: String(node.attrs.label ?? node.attrs.identifier ?? ''),
          referenceType: String(node.attrs.referenceType ?? 'full'),
        })
        .next(node.content)
        .closeNode(),
  },
}))

const imageReferenceSchema = $nodeSchema('image_reference', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    alt: { default: '', validate: 'string' },
    identifier: { default: '', validate: 'string' },
    label: { default: '', validate: 'string' },
    referenceType: { default: 'full', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'span[data-openmd-image-reference]',
      getAttrs: (element) => {
        if (!(element instanceof HTMLElement)) return false
        return {
          alt: element.dataset.alt ?? '',
          identifier: element.dataset.identifier ?? '',
          label: element.dataset.label ?? '',
          referenceType: element.dataset.referenceType ?? 'full',
        }
      },
    },
  ],
  toDOM: (node) => [
    'span',
    {
      class: 'openmd-image-reference',
      'data-openmd-image-reference': 'true',
      'data-alt': node.attrs.alt,
      'data-identifier': node.attrs.identifier,
      'data-label': node.attrs.label,
      'data-reference-type': node.attrs.referenceType,
    },
    `![${String(node.attrs.alt ?? '')}][${String(node.attrs.label ?? node.attrs.identifier ?? '')}]`,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'imageReference',
    runner: (state, node, type) =>
      state.addNode(type, {
        alt: String(node.alt ?? ''),
        identifier: String(node.identifier ?? ''),
        label: String(node.label ?? node.identifier ?? ''),
        referenceType: String(node.referenceType ?? 'full'),
      }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'image_reference',
    runner: (state, node) =>
      state.addNode('imageReference', undefined, undefined, {
        alt: String(node.attrs.alt ?? ''),
        identifier: String(node.attrs.identifier ?? ''),
        label: String(node.attrs.label ?? node.attrs.identifier ?? ''),
        referenceType: String(node.attrs.referenceType ?? 'full'),
      }),
  },
}))

class RawMarkdownNodeView implements NodeView {
  readonly dom: HTMLElement
  private readonly source: HTMLTextAreaElement
  private node: ProseMirrorNode
  private composing = false

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    kind: 'frontmatter' | 'html' | 'markdown',
  ) {
    this.node = node
    const ownerDocument = view.dom.ownerDocument
    this.dom = ownerDocument.createElement('aside')
    this.dom.className =
      kind === 'frontmatter'
        ? 'openmd-frontmatter'
        : kind === 'html'
          ? 'openmd-raw-markdown openmd-raw-html'
          : 'openmd-raw-markdown openmd-raw-unsupported'
    this.dom.dataset.openmdRawEditor = kind
    this.dom.contentEditable = 'false'

    const label = ownerDocument.createElement('div')
    label.className =
      kind === 'frontmatter' ? 'openmd-frontmatter__label' : 'openmd-raw-markdown__label'
    label.textContent =
      kind === 'frontmatter'
        ? 'YAML Front Matter'
        : kind === 'html'
          ? '原始 HTML（仅显示源码，不会执行）'
          : '暂不支持的 Markdown（按源码保留）'

    this.source = ownerDocument.createElement('textarea')
    this.source.className =
      kind === 'frontmatter' ? 'openmd-frontmatter__source' : 'openmd-raw-markdown__source'
    this.source.value = String(node.attrs.value ?? '')
    this.source.spellcheck = false
    this.source.readOnly = !view.editable
    this.source.setAttribute(
      'aria-label',
      kind === 'frontmatter'
        ? 'YAML Front Matter 源码'
        : kind === 'html'
          ? '原始 HTML 源码'
          : '暂不支持的 Markdown 源码',
    )
    this.source.addEventListener('input', this.onInput)
    this.source.addEventListener('compositionstart', this.onCompositionStart)
    this.source.addEventListener('compositionend', this.onCompositionEnd)
    this.dom.append(label, this.source)
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    const value = String(node.attrs.value ?? '')
    if (!this.composing && this.source.value !== value) this.source.value = value
    this.source.readOnly = !this.view.editable
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.dom.contains(event.target)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.source.removeEventListener('input', this.onInput)
    this.source.removeEventListener('compositionstart', this.onCompositionStart)
    this.source.removeEventListener('compositionend', this.onCompositionEnd)
  }

  private updateSource(): void {
    const position = this.getPos()
    if (position === undefined) return
    const current = this.view.state.doc.nodeAt(position)
    if (!current || current.type !== this.node.type) return
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, {
        ...current.attrs,
        value: this.source.value,
      }),
    )
  }

  private onInput = (): void => {
    if (!this.composing) this.updateSource()
  }
  private onCompositionStart = (): void => {
    this.composing = true
  }
  private onCompositionEnd = (): void => {
    this.composing = false
    this.updateSource()
  }
}

class FootnoteReferenceNodeView implements NodeView {
  readonly dom: HTMLElement

  constructor(
    private node: ProseMirrorNode,
    view: EditorView,
  ) {
    this.dom = view.dom.ownerDocument.createElement('sup')
    this.dom.className = 'openmd-footnote-reference'
    this.dom.contentEditable = 'false'
    this.dom.dataset.type = 'footnote_reference'
    this.dom.tabIndex = 0
    this.dom.setAttribute('role', 'link')
    this.render()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  ignoreMutation(): boolean {
    return true
  }

  private render(): void {
    const label = String(this.node.attrs.label ?? '')
    this.dom.dataset.label = label
    this.dom.textContent = label
    this.dom.setAttribute('aria-label', `跳转到脚注 ${label}`)
  }
}

class ReferenceDefinitionNodeView implements NodeView {
  readonly dom: HTMLElement
  private readonly urlInput: HTMLInputElement
  private readonly titleInput: HTMLInputElement
  private node: ProseMirrorNode
  private composing = false

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node
    const ownerDocument = view.dom.ownerDocument
    this.dom = ownerDocument.createElement('div')
    this.dom.className = 'openmd-reference-definition'
    this.dom.dataset.openmdReferenceDefinition = 'true'
    this.dom.contentEditable = 'false'

    const label = ownerDocument.createElement('code')
    label.className = 'openmd-reference-definition__label'
    label.textContent = `[${String(node.attrs.label ?? node.attrs.identifier ?? '')}]:`

    this.urlInput = ownerDocument.createElement('input')
    this.urlInput.className = 'openmd-reference-definition__url'
    this.urlInput.type = 'text'
    this.urlInput.spellcheck = false

    this.titleInput = ownerDocument.createElement('input')
    this.titleInput.className = 'openmd-reference-definition__title'
    this.titleInput.type = 'text'
    this.titleInput.placeholder = '可选标题'

    for (const input of [this.urlInput, this.titleInput]) {
      input.addEventListener('input', this.onInput)
      input.addEventListener('compositionstart', this.onCompositionStart)
      input.addEventListener('compositionend', this.onCompositionEnd)
    }
    this.dom.append(label, this.urlInput, this.titleInput)
    this.render()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.dom.contains(event.target)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    for (const input of [this.urlInput, this.titleInput]) {
      input.removeEventListener('input', this.onInput)
      input.removeEventListener('compositionstart', this.onCompositionStart)
      input.removeEventListener('compositionend', this.onCompositionEnd)
    }
  }

  private render(): void {
    const label = String(this.node.attrs.label ?? this.node.attrs.identifier ?? '')
    const url = String(this.node.attrs.url ?? '')
    const title = typeof this.node.attrs.title === 'string' ? this.node.attrs.title : ''
    this.dom.dataset.identifier = String(this.node.attrs.identifier ?? '')
    this.dom.dataset.label = label
    this.dom.dataset.url = url
    this.dom.dataset.title = title
    if (!this.composing && this.urlInput.value !== url) this.urlInput.value = url
    if (!this.composing && this.titleInput.value !== title) this.titleInput.value = title
    this.urlInput.readOnly = !this.view.editable
    this.titleInput.readOnly = !this.view.editable
    this.urlInput.setAttribute('aria-label', `引用定义 ${label} URL`)
    this.titleInput.setAttribute('aria-label', `引用定义 ${label} 标题`)
  }

  private updateDefinition(): void {
    const position = this.getPos()
    if (position === undefined) return
    const current = this.view.state.doc.nodeAt(position)
    if (!current || current.type !== this.node.type) return
    const identifier = String(current.attrs.identifier ?? '').toLocaleLowerCase('en-US')
    const resolvedTitle = this.titleInput.value || null
    let transaction = this.view.state.tr.setNodeMarkup(position, undefined, {
      ...current.attrs,
      title: resolvedTitle,
      url: this.urlInput.value,
    })
    transaction.doc.descendants((descendant, descendantPosition) => {
      if (
        descendant.type.name !== 'link_reference' ||
        String(descendant.attrs.identifier ?? '').toLocaleLowerCase('en-US') !== identifier
      ) {
        return
      }
      transaction = transaction.setNodeMarkup(descendantPosition, undefined, {
        ...descendant.attrs,
        resolvedTitle,
        resolvedUrl: this.urlInput.value,
      })
    })
    this.view.dispatch(transaction)
  }

  private onInput = (): void => {
    if (!this.composing) this.updateDefinition()
  }
  private onCompositionStart = (): void => {
    this.composing = true
  }
  private onCompositionEnd = (): void => {
    this.composing = false
    this.updateDefinition()
  }
}

const rawMarkdownNodeViews = $prose(
  () =>
    new Plugin({
      key: new PluginKey('openmd-raw-markdown-node-views'),
      props: {
        nodeViews: {
          front_matter: (node, view, getPos) =>
            new RawMarkdownNodeView(node, view, getPos, 'frontmatter'),
          raw_html_block: (node, view, getPos) =>
            new RawMarkdownNodeView(node, view, getPos, 'html'),
          raw_markdown_block: (node, view, getPos) =>
            new RawMarkdownNodeView(node, view, getPos, 'markdown'),
          reference_definition: (node, view, getPos) =>
            new ReferenceDefinitionNodeView(node, view, getPos),
          footnote_reference: (node, view) => new FootnoteReferenceNodeView(node, view),
        },
      },
    }),
)

class FootnoteInteractionView {
  private readonly tooltip: HTMLDivElement
  private readonly ownerDocument: Document
  private activeReference: HTMLElement | null = null

  constructor(private view: EditorView) {
    this.ownerDocument = view.dom.ownerDocument
    this.tooltip = this.ownerDocument.createElement('div')
    this.tooltip.className = 'openmd-footnote-preview'
    this.tooltip.hidden = true
    this.tooltip.setAttribute('role', 'tooltip')
    this.ownerDocument.body.appendChild(this.tooltip)
    view.dom.addEventListener('click', this.onClick)
    view.dom.addEventListener('keydown', this.onKeyDown)
    view.dom.addEventListener('pointerover', this.onPointerOver)
    view.dom.addEventListener('pointerout', this.onPointerOut)
    view.dom.addEventListener('focusin', this.onFocusIn)
    view.dom.addEventListener('focusout', this.onFocusOut)
  }

  update = (view: EditorView): void => {
    this.view = view
  }

  destroy = (): void => {
    this.view.dom.removeEventListener('click', this.onClick)
    this.view.dom.removeEventListener('keydown', this.onKeyDown)
    this.view.dom.removeEventListener('pointerover', this.onPointerOver)
    this.view.dom.removeEventListener('pointerout', this.onPointerOut)
    this.view.dom.removeEventListener('focusin', this.onFocusIn)
    this.view.dom.removeEventListener('focusout', this.onFocusOut)
    this.tooltip.remove()
  }

  private referenceFromTarget(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element
      ? target.closest<HTMLElement>('sup[data-type="footnote_reference"]')
      : null
  }

  private definitionFor(reference: HTMLElement): HTMLElement | undefined {
    const label = reference.dataset.label ?? ''
    return [
      ...this.view.dom.querySelectorAll<HTMLElement>('dl[data-type="footnote_definition"]'),
    ].find((definition) => definition.dataset.label === label)
  }

  private showPreview(reference: HTMLElement): void {
    const definition = this.definitionFor(reference)
    if (!definition) return
    this.activeReference = reference
    this.tooltip.textContent = definition.querySelector('dd')?.textContent?.trim() ?? ''
    this.tooltip.hidden = false
    const bounds = reference.getBoundingClientRect()
    this.tooltip.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 328))}px`
    this.tooltip.style.top = `${Math.max(8, bounds.bottom + 8)}px`
    reference.setAttribute('aria-describedby', 'openmd-footnote-preview')
    this.tooltip.id = 'openmd-footnote-preview'
  }

  private hidePreview(reference?: HTMLElement): void {
    if (reference && this.activeReference !== reference) return
    this.activeReference?.removeAttribute('aria-describedby')
    this.activeReference = null
    this.tooltip.hidden = true
    this.tooltip.textContent = ''
  }

  private jump(reference: HTMLElement): void {
    const definition = this.definitionFor(reference)
    if (!definition) return
    definition.scrollIntoView({ block: 'center' })
    try {
      const position = this.view.posAtDOM(definition.querySelector('dd') ?? definition, 0)
      this.view.dispatch(
        this.view.state.tr
          .setSelection(Selection.near(this.view.state.doc.resolve(position), 1))
          .scrollIntoView(),
      )
      this.view.focus()
    } catch {
      // The definition can disappear between the event and the resolved DOM position.
    }
  }

  private onClick = (event: MouseEvent): void => {
    const reference = this.referenceFromTarget(event.target)
    if (!reference) return
    event.preventDefault()
    this.jump(reference)
  }
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const reference = this.referenceFromTarget(event.target)
    if (!reference) return
    event.preventDefault()
    this.jump(reference)
  }
  private onPointerOver = (event: PointerEvent): void => {
    const reference = this.referenceFromTarget(event.target)
    if (reference) this.showPreview(reference)
  }
  private onPointerOut = (event: PointerEvent): void => {
    const reference = this.referenceFromTarget(event.target)
    if (
      reference &&
      !(event.relatedTarget instanceof Node && reference.contains(event.relatedTarget))
    ) {
      this.hidePreview(reference)
    }
  }
  private onFocusIn = (event: FocusEvent): void => {
    const reference = this.referenceFromTarget(event.target)
    if (reference) this.showPreview(reference)
  }
  private onFocusOut = (event: FocusEvent): void => {
    const reference = this.referenceFromTarget(event.target)
    if (reference) this.hidePreview(reference)
  }
}

const footnoteInteractionPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('openmd-footnote-interaction'),
      view: (view) => new FootnoteInteractionView(view),
    }),
)

export const markdownCompatibilityPlugins = [
  frontmatterRemarkPlugin,
  compatibilityTransformRemarkPlugin,
  frontmatterSchema,
  rawHtmlBlockSchema,
  rawMarkdownBlockSchema,
  alertSchema,
  referenceDefinitionSchema,
  linkReferenceSchema,
  imageReferenceSchema,
  rawMarkdownNodeViews,
  footnoteInteractionPlugin,
].flat()

/**
 * Crepe's commonmark preset intentionally inlines references and wraps block
 * HTML as inline nodes. Both transformations are lossy for a source editor, so
 * the compatibility schemas above replace them before the editor is created.
 */
export async function prepareMarkdownCompatibility(editor: Editor): Promise<void> {
  await editor.remove([...remarkInlineLinkPlugin, ...remarkHtmlTransformer])
}

/** Keep dangerous link schemes out of the live DOM while preserving source. */
export function configureSafeMarkdownLinks(
  ctx: Parameters<Parameters<Editor['config']>[0]>[0],
): void {
  ctx.update(linkSchema.key, (previousFactory) => (innerCtx) => {
    const previous = previousFactory(innerCtx)
    const toDOM = previous.toDOM
    return {
      ...previous,
      toDOM: (mark) => {
        const output = toDOM?.(mark, false)
        if (!Array.isArray(output)) return output ?? ['span', 0]
        const attributes =
          typeof output[1] === 'object' && output[1] && !Array.isArray(output[1]) ? output[1] : {}
        return [
          output[0],
          {
            ...attributes,
            href: safeVisualHref(mark.attrs.href),
          },
          ...output.slice(2),
        ]
      },
    }
  })
}
