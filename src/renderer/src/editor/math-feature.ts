import { CrepeFeature } from '@milkdown/crepe'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import katex from 'katex'
import type { KatexOptions } from 'katex'

/** Node name used by Crepe's standard remark-math/LaTeX feature. */
export const OPENMD_INLINE_MATH_NODE_NAME = 'math_inline'
export const OPENMD_BLOCK_MATH_LANGUAGE = 'latex'

/** Spread this into Crepe's `features` option to install remark-math and its schemas. */
export const openMdMathFeatures = {
  [CrepeFeature.Latex]: true,
} satisfies Partial<Record<CrepeFeature, boolean>>

export interface MathRenderOutcome {
  ok: boolean
  error?: string
}

export type OpenMdMathRenderer = (
  source: string,
  target: HTMLElement,
  options: KatexOptions,
) => void

export interface OpenMdMathFeatureOptions {
  katexOptions?: KatexOptions
  /** Injectable for deterministic tests; production defaults to `katex.render`. */
  renderer?: OpenMdMathRenderer
}

function mathSource(node: ProseMirrorNode): string {
  return typeof node.attrs.value === 'string' ? node.attrs.value : ''
}

function mathErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || '未知错误')
  const normalized = detail.replace(/^KaTeX parse error:\s*/i, '').trim()
  return `公式语法错误：${normalized || '无法解析公式。'}`
}

/**
 * Render into an owned element and turn every renderer failure into visible,
 * editable-safe DOM. No renderer HTML string is assigned through `innerHTML`.
 */
export function renderMathSafely(
  source: string,
  target: HTMLElement,
  {
    displayMode = false,
    katexOptions,
    renderer = katex.render,
  }: OpenMdMathFeatureOptions & { displayMode?: boolean } = {},
): MathRenderOutcome {
  target.replaceChildren()

  try {
    renderer(source, target, {
      ...katexOptions,
      displayMode,
      // These options are intentionally enforced after caller options. KaTeX
      // must never execute trusted HTML/URL commands, and failures must be
      // caught here rather than rendered as opaque markup.
      throwOnError: true,
      trust: false,
      strict: 'error',
    })
    return { ok: true }
  } catch (error) {
    const fallback = target.ownerDocument.createElement('code')
    fallback.className = 'openmd-math-source-fallback'
    fallback.textContent = source
    target.replaceChildren(fallback)
    return { ok: false, error: mathErrorMessage(error) }
  }
}

export function createMathBlockPreview(
  source: string,
  options: OpenMdMathFeatureOptions = {},
  ownerDocument: Document = document,
): HTMLElement {
  const preview = ownerDocument.createElement('div')
  preview.className = 'openmd-math-block'
  preview.dataset.mathDisplay = 'block'
  preview.style.color = 'inherit'

  const output = ownerDocument.createElement('div')
  output.className = 'openmd-math-preview'
  output.tabIndex = 0
  output.setAttribute('role', 'button')
  output.setAttribute('aria-label', '块级数学公式')
  preview.appendChild(output)

  const outcome = renderMathSafely(source, output, { ...options, displayMode: true })
  preview.dataset.state = outcome.ok ? 'ready' : 'error'

  if (!outcome.ok) {
    const status = ownerDocument.createElement('div')
    status.className = 'openmd-math-error'
    status.setAttribute('role', 'alert')
    status.textContent = outcome.error ?? '公式渲染失败。'
    preview.appendChild(status)
  }

  return preview
}

export function isBlockMathLanguage(language: string): boolean {
  return language.trim().toLowerCase() === OPENMD_BLOCK_MATH_LANGUAGE
}

/**
 * Crepe parses `$$` into a `code_block` with language `LaTeX`. Keep its
 * CodeMirror source editor, but replace only that preview path with a safe DOM
 * renderer. Other fenced code previews continue through the existing config.
 */
export function configureOpenMdMath(ctx: Ctx, options: OpenMdMathFeatureOptions = {}): void {
  ctx.update(codeBlockConfig.key, (current) => {
    const renderCodePreview = current.renderPreview
    return {
      ...current,
      renderPreview: (language, content, applyPreview) => {
        if (!isBlockMathLanguage(language)) {
          return renderCodePreview(language, content, applyPreview)
        }
        return createMathBlockPreview(content, options)
      },
    }
  })
}

export class OpenMdInlineMathNodeView implements NodeView {
  readonly dom: HTMLElement
  private readonly preview: HTMLElement
  private readonly sourceInput: HTMLInputElement
  private readonly status: HTMLElement
  private node: ProseMirrorNode
  private composing = false
  private destroyed = false
  private renderedSource: string | null = null

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly options: OpenMdMathFeatureOptions = {},
  ) {
    this.node = node
    const ownerDocument = view.dom.ownerDocument

    this.dom = ownerDocument.createElement('span')
    this.dom.className = 'openmd-math-inline'
    this.dom.contentEditable = 'false'
    this.dom.dataset.mathDisplay = 'inline'
    this.dom.dataset.editing = 'false'

    this.preview = ownerDocument.createElement('span')
    this.preview.className = 'openmd-math-preview'
    this.preview.tabIndex = 0
    this.preview.setAttribute('role', 'button')
    this.preview.setAttribute('aria-label', '行内数学公式，点击编辑源码')

    this.sourceInput = ownerDocument.createElement('input')
    this.sourceInput.className = 'openmd-math-source'
    this.sourceInput.type = 'text'
    this.sourceInput.hidden = true
    this.sourceInput.spellcheck = false
    this.sourceInput.autocomplete = 'off'
    this.sourceInput.setAttribute('aria-label', 'LaTeX 公式源码')
    this.sourceInput.value = mathSource(node)

    this.status = ownerDocument.createElement('span')
    this.status.className = 'openmd-math-error'
    this.status.hidden = true
    this.status.setAttribute('role', 'alert')
    this.status.setAttribute('aria-live', 'polite')

    this.dom.append(this.preview, this.sourceInput, this.status)
    this.preview.addEventListener('click', this.onPreviewClick)
    this.preview.addEventListener('keydown', this.onPreviewKeyDown)
    this.sourceInput.addEventListener('input', this.onSourceInput)
    this.sourceInput.addEventListener('blur', this.onSourceBlur)
    this.sourceInput.addEventListener('keydown', this.onSourceKeyDown)
    this.sourceInput.addEventListener('compositionstart', this.onCompositionStart)
    this.sourceInput.addEventListener('compositionend', this.onCompositionEnd)
    this.render()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    const source = mathSource(node)
    if (!this.composing && this.sourceInput.value !== source) this.sourceInput.value = source
    this.render()
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  /** Keep formula clicks and input keystrokes away from Crepe's confirm-only tooltip. */
  stopEvent(event: Event): boolean {
    return event.target instanceof Node && this.dom.contains(event.target)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.destroyed = true
    this.preview.removeEventListener('click', this.onPreviewClick)
    this.preview.removeEventListener('keydown', this.onPreviewKeyDown)
    this.sourceInput.removeEventListener('input', this.onSourceInput)
    this.sourceInput.removeEventListener('blur', this.onSourceBlur)
    this.sourceInput.removeEventListener('keydown', this.onSourceKeyDown)
    this.sourceInput.removeEventListener('compositionstart', this.onCompositionStart)
    this.sourceInput.removeEventListener('compositionend', this.onCompositionEnd)
  }

  private render(): void {
    if (this.destroyed) return
    const source = mathSource(this.node)
    if (source === this.renderedSource) return
    this.renderedSource = source
    const outcome = renderMathSafely(source, this.preview, this.options)
    this.dom.dataset.state = outcome.ok ? 'ready' : 'error'
    this.sourceInput.setAttribute('aria-invalid', String(!outcome.ok))
    this.status.hidden = outcome.ok
    this.status.textContent = outcome.error ?? ''
    this.preview.title = outcome.error ?? ''
  }

  private startEditing(): void {
    if (!this.view.editable || this.destroyed) return
    this.dom.dataset.editing = 'true'
    this.sourceInput.hidden = false
    this.sourceInput.focus()
    const end = this.sourceInput.value.length
    this.sourceInput.setSelectionRange(end, end)
  }

  private finishEditing(): void {
    this.dom.dataset.editing = 'false'
    this.sourceInput.hidden = true
  }

  private updateSource(): void {
    const position = this.getPos()
    if (position === undefined) {
      this.render()
      return
    }

    const current = this.view.state.doc.nodeAt(position)
    if (!current || current.type !== this.node.type) return
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, {
        ...current.attrs,
        value: this.sourceInput.value,
      }),
    )
  }

  private onPreviewClick = (event: MouseEvent): void => {
    event.preventDefault()
    this.startEditing()
  }

  private onPreviewKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    this.startEditing()
  }

  private onSourceInput = (): void => {
    this.updateSource()
  }

  private onSourceBlur = (): void => {
    this.finishEditing()
  }

  private onSourceKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    this.finishEditing()
    this.view.focus()
  }

  private onCompositionStart = (): void => {
    this.composing = true
  }

  private onCompositionEnd = (): void => {
    this.composing = false
    this.updateSource()
  }
}

function mathCodeBlockFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const preview = target.closest('.openmd-math-block')
  return preview?.closest<HTMLElement>('.milkdown-code-block') ?? null
}

function isMathCodeBlock(block: HTMLElement): boolean {
  return block.querySelector('.openmd-math-block') !== null
}

function setMathBlockEditing(block: HTMLElement, editing: boolean): void {
  const codeMirrorHost = block.querySelector<HTMLElement>('.codemirror-host')
  const toggle = block.querySelector<HTMLButtonElement>('.preview-toggle-button')
  if (!codeMirrorHost || !toggle) return

  block.dataset.openmdMathEditing = String(editing)
  const previewOnly = codeMirrorHost.classList.contains('hidden')
  if (editing === previewOnly) toggle.click()
}

function createMathBlockInteractionPlugin() {
  const key = new PluginKey('openmd-math-block-interaction')
  return $prose(
    () =>
      new Plugin({
        key,
        view: (view) => {
          let destroyed = false

          const showSource = (block: HTMLElement): void => {
            if (!view.editable || destroyed) return
            setMathBlockEditing(block, true)
            queueMicrotask(() => {
              if (destroyed || !block.isConnected) return
              block.querySelector<HTMLElement>('.cm-content')?.focus()
            })
          }

          const showPreview = (block: HTMLElement): void => {
            if (destroyed) return
            setMathBlockEditing(block, false)
          }

          const syncBlocks = (): void => {
            view.dom.querySelectorAll<HTMLElement>('.milkdown-code-block').forEach((block) => {
              if (!isMathCodeBlock(block)) return
              if (!view.editable || block.dataset.openmdMathEditing !== 'true') {
                showPreview(block)
              }
            })
          }

          const onClick = (event: MouseEvent): void => {
            const block = mathCodeBlockFromTarget(event.target)
            if (!block) return
            event.preventDefault()
            showSource(block)
          }

          const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            const block = mathCodeBlockFromTarget(event.target)
            if (!block) return
            event.preventDefault()
            showSource(block)
          }

          const onFocusOut = (event: FocusEvent): void => {
            if (!(event.target instanceof Element)) return
            const block = event.target.closest<HTMLElement>('.milkdown-code-block')
            if (!block || !isMathCodeBlock(block)) return

            queueMicrotask(() => {
              if (destroyed || !block.isConnected) return
              const activeElement = view.dom.ownerDocument.activeElement
              if (activeElement && block.contains(activeElement)) return
              showPreview(block)
            })
          }

          const onDocumentFocusIn = (event: FocusEvent): void => {
            view.dom
              .querySelectorAll<HTMLElement>('[data-openmd-math-editing="true"]')
              .forEach((block) => {
                if (event.target instanceof Node && block.contains(event.target)) return
                showPreview(block)
              })
          }

          const observer = new MutationObserver(syncBlocks)
          observer.observe(view.dom, { childList: true, subtree: true })
          view.dom.addEventListener('click', onClick, true)
          view.dom.addEventListener('keydown', onKeyDown, true)
          view.dom.addEventListener('focusout', onFocusOut, true)
          view.dom.ownerDocument.addEventListener('focusin', onDocumentFocusIn, true)
          queueMicrotask(syncBlocks)

          return {
            update: syncBlocks,
            destroy: () => {
              destroyed = true
              observer.disconnect()
              view.dom.removeEventListener('click', onClick, true)
              view.dom.removeEventListener('keydown', onKeyDown, true)
              view.dom.removeEventListener('focusout', onFocusOut, true)
              view.dom.ownerDocument.removeEventListener('focusin', onDocumentFocusIn, true)
              view.dom
                .querySelectorAll<HTMLElement>('[data-openmd-math-editing]')
                .forEach((block) => delete block.dataset.openmdMathEditing)
            },
          }
        },
      }),
  )
}

export function createOpenMdMathFeature(options: OpenMdMathFeatureOptions = {}) {
  const inlineMathNodeViewKey = new PluginKey('openmd-inline-math-node-view')
  const inlineMathNodeView = $prose(
    () =>
      new Plugin({
        key: inlineMathNodeViewKey,
        props: {
          nodeViews: {
            [OPENMD_INLINE_MATH_NODE_NAME]: (node, view, getPos) =>
              new OpenMdInlineMathNodeView(node, view, getPos, options),
          },
        },
      }),
  )
  const blockMathInteraction = createMathBlockInteractionPlugin()

  return {
    plugins: [inlineMathNodeView, blockMathInteraction],
    configure: (ctx: Ctx): void => configureOpenMdMath(ctx, options),
  }
}
