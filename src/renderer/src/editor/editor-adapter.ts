import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'

import {
  blockSourcePlugin,
  commitBlockSourceEditing,
  isBlockSourceEditing,
} from './block-source-plugin'
import { configureOpenMdCodeBlocks } from './code-block-config'
import {
  commitHeadingSourceEditing,
  headingSourcePlugin,
  isHeadingSourceEditing,
} from './heading-source-plugin'
import {
  commitInlineSourceEditing,
  inlineSourcePlugin,
  isInlineSourceEditing,
} from './inline-source-plugin'
import { openMdInsertMenuConfig } from './insert-menu-config'
import { createOpenMdImageFeature, type RendererImagesApi } from './image-feature'
import { listEditingPlugin } from './list-editing-plugin'
import { createOpenMdMathFeature, openMdMathFeatures } from './math-feature'
import { createOpenMdMermaidFeature } from './mermaid-feature'
import type { OutlineItem } from './outline-feature'
import { openMdTableFeatures, openMdTablePlugins } from './table-feature'
import { createDocumentOutlineFeature } from './toc-feature'
import type { CursorAnchor, EditorDocumentAdapter } from './editor.types'

export interface EditorAdapterOptions {
  root: HTMLElement
  initialMarkdown: string
  readOnly: boolean
  onChange: (markdown: string) => void
  imagesApi?: RendererImagesApi
  getDocumentPath?: () => string | undefined
  onEnsureDocumentSaved?: () => Promise<string | undefined>
  onOutlineChange?: (outline: readonly OutlineItem[]) => void
  onActiveHeadingChange?: (id: string | null) => void
}

const unavailableImagesApi: RendererImagesApi = {
  saveImage: async () => ({
    canceled: false,
    error: { code: 'invalid-request', message: '图片保存服务不可用。' },
  }),
  selectImage: async () => ({ canceled: true }),
  resolveImage: async () => ({
    ok: false,
    error: { code: 'invalid-request', message: '图片读取服务不可用。' },
  }),
}

export class OpenMdEditorAdapter implements EditorDocumentAdapter {
  private readonly crepe: Crepe
  private readonly imageFeature: ReturnType<typeof createOpenMdImageFeature>
  private readonly mathFeature = createOpenMdMathFeature()
  private readonly mermaidFeature = createOpenMdMermaidFeature()
  private readonly outlineFeature = createDocumentOutlineFeature({ viewportOffset: 72 })
  private readonly unsubscribeOutline: Array<() => void>
  private markdown: string
  private markdownDocument: ProseMirrorNode | null = null
  private programmaticDocument: ProseMirrorNode | null = null
  private destroyed = false
  private created = false
  private initializing = true
  private programmaticUpdateActive = true
  private programmaticUpdateGeneration = 0
  private stabilizationPromise: Promise<void> = Promise.resolve()
  private readonly removeUserIntentListeners: () => void

  constructor(options: EditorAdapterOptions) {
    this.markdown = options.initialMarkdown
    const userIntentEvents = [
      'beforeinput',
      'compositionstart',
      'contextmenu',
      'drop',
      'keydown',
      'mousedown',
      'paste',
    ] as const
    const handleUserIntent = (): void => this.finishProgrammaticUpdate()
    userIntentEvents.forEach((eventName) =>
      options.root.addEventListener(eventName, handleUserIntent, true),
    )
    this.removeUserIntentListeners = () => {
      userIntentEvents.forEach((eventName) =>
        options.root.removeEventListener(eventName, handleUserIntent, true),
      )
    }
    this.unsubscribeOutline = [
      this.outlineFeature.controller.subscribe(
        (outline) => options.onOutlineChange?.(outline),
        true,
      ),
      this.outlineFeature.controller.subscribeActive(
        (id) => options.onActiveHeadingChange?.(id),
        true,
      ),
    ]
    this.imageFeature = createOpenMdImageFeature({
      imagesApi: options.imagesApi ?? unavailableImagesApi,
      getDocumentPath: options.getDocumentPath ?? (() => undefined),
      onEnsureDocumentSaved: options.onEnsureDocumentSaved ?? (async () => undefined),
    })
    this.crepe = new Crepe({
      root: options.root,
      defaultValue: options.initialMarkdown,
      features: {
        ...openMdTableFeatures,
        ...openMdMathFeatures,
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.ListItem]: true,
        [CrepeFeature.LinkTooltip]: false,
        [CrepeFeature.BlockEdit]: true,
        [CrepeFeature.Toolbar]: false,
        [CrepeFeature.ImageBlock]: false,
      },
      featureConfigs: {
        [CrepeFeature.Placeholder]: { text: '开始写作…' },
        [CrepeFeature.BlockEdit]: openMdInsertMenuConfig,
      },
    })
    this.crepe.editor.config(configureOpenMdCodeBlocks)
    this.crepe.editor.config(this.mathFeature.configure)
    this.crepe.editor.config(this.mermaidFeature.configureCodeBlocks)
    this.crepe.editor.config(this.outlineFeature.configure)
    this.crepe.editor.config(this.imageFeature.configureUpload)
    this.crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        bullet: '-' as const,
        fence: '`' as const,
        fences: true,
        rule: '-' as const,
        ruleRepetition: 3,
        ruleSpaces: false,
      }))
    })
    this.crepe.editor.use(headingSourcePlugin)
    this.crepe.editor.use(inlineSourcePlugin)
    this.crepe.editor.use(blockSourcePlugin)
    this.crepe.editor.use(listEditingPlugin)
    this.crepe.editor.use(openMdTablePlugins)
    this.crepe.editor.use(this.imageFeature.plugins)
    this.crepe.editor.use(this.mathFeature.plugins)
    this.crepe.editor.use(this.mermaidFeature.plugins)
    this.crepe.editor.use(this.outlineFeature.plugins)

    this.crepe.setReadonly(options.readOnly).on((listener) => {
      listener.markdownUpdated((ctx, markdown) => {
        if (this.destroyed) return
        const state = ctx.get(editorViewCtx).state
        if (this.initializing || this.programmaticUpdateActive) {
          this.markdownDocument = state.doc
          this.programmaticDocument = state.doc
          return
        }
        // Milkdown debounces listener transactions. A source draft can already
        // have been committed or cancelled when an older callback arrives.
        if (ctx.get(serializerCtx)(state.doc) !== markdown) return
        if (
          isHeadingSourceEditing(state) ||
          isInlineSourceEditing(state) ||
          isBlockSourceEditing(state)
        ) {
          return
        }
        if (this.programmaticDocument?.eq(state.doc)) return

        this.programmaticDocument = null
        this.markdown = markdown
        this.markdownDocument = state.doc
        options.onChange(markdown)
      })
    })
  }

  async create(): Promise<void> {
    await this.crepe.create()
    this.created = true
    if (this.destroyed) {
      await this.destroyEditor()
      return
    }
    const generation = this.startProgrammaticUpdate()
    if (this.crepe.getMarkdown() !== this.markdown) {
      this.applyMarkdown(this.markdown)
    } else {
      this.captureMarkdownDocument(true)
    }
    this.stabilizationPromise = this.stabilizeProgrammaticDocument(generation)
    await this.stabilizationPromise
    if (this.destroyed) {
      await this.destroyEditor()
      return
    }
  }

  getMarkdown(): string {
    if (!this.created || this.destroyed) return this.markdown

    if (this.initializing || this.programmaticUpdateActive) {
      this.captureMarkdownDocument(true)
      return this.markdown
    }

    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      commitHeadingSourceEditing(view)
      commitInlineSourceEditing(view)
      commitBlockSourceEditing(view)

      const document = view.state.doc
      if (this.markdownDocument?.eq(document)) return

      this.programmaticDocument = null
      this.markdown = ctx.get(serializerCtx)(document)
      this.markdownDocument = document
    })
    return this.markdown
  }

  setMarkdown(markdown: string): void {
    if (this.destroyed) return

    this.markdown = markdown
    if (this.created) {
      const generation = this.startProgrammaticUpdate()
      this.applyMarkdown(markdown)
      this.stabilizationPromise = this.stabilizeProgrammaticDocument(generation)
    }
  }

  private applyMarkdown(markdown: string): void {
    this.crepe.editor.action(replaceAll(markdown, true))
    this.captureMarkdownDocument(true)
  }

  private captureMarkdownDocument(programmatic = false): void {
    this.crepe.editor.action((ctx) => {
      const document = ctx.get(editorViewCtx).state.doc
      this.markdownDocument = document
      this.programmaticDocument = programmatic ? document : null
    })
  }

  private startProgrammaticUpdate(): number {
    this.programmaticUpdateActive = true
    return ++this.programmaticUpdateGeneration
  }

  private finishProgrammaticUpdate(): void {
    if (!this.created || this.destroyed || this.initializing || !this.programmaticUpdateActive) {
      return
    }

    this.programmaticUpdateGeneration += 1
    this.captureMarkdownDocument(true)
    this.programmaticUpdateActive = false
  }

  private getCurrentDocument(): ProseMirrorNode {
    return this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
  }

  private async stabilizeProgrammaticDocument(generation: number): Promise<void> {
    let previousDocument = this.getCurrentDocument()
    let stableChecks = 0

    for (let attempt = 0; attempt < 10 && stableChecks < 3; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      if (this.destroyed || generation !== this.programmaticUpdateGeneration) return

      const currentDocument = this.getCurrentDocument()
      stableChecks = previousDocument.eq(currentDocument) ? stableChecks + 1 : 0
      previousDocument = currentDocument
    }

    if (this.destroyed || generation !== this.programmaticUpdateGeneration) return
    // Crepe features may append structural nodes during their first updates.
    // Treat the settled document as the parsed representation of the original
    // Markdown so merely entering visual mode cannot rewrite or dirty it.
    this.captureMarkdownDocument(true)
    this.programmaticUpdateActive = false
    this.initializing = false
  }

  setReadOnly(readOnly: boolean): void {
    this.crepe.setReadonly(readOnly)
  }

  async whenStable(): Promise<void> {
    while (true) {
      const stabilization = this.stabilizationPromise
      await stabilization
      if (stabilization === this.stabilizationPromise) return
    }
  }

  focus(): void {
    if (this.destroyed || !this.created) return
    this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
  }

  getCursorAnchor(): CursorAnchor | undefined {
    if (this.destroyed || !this.created) return undefined

    let anchor: CursorAnchor | undefined
    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      commitHeadingSourceEditing(view)
      commitInlineSourceEditing(view)
      commitBlockSourceEditing(view)

      const position = view.state.selection.anchor
      let activeBlockIndex = 0
      let nearestHeading: string | undefined

      view.state.doc.forEach((node, offset, index) => {
        const start = offset + 1
        const end = offset + node.nodeSize
        if (node.type.name === 'heading' && start <= position) {
          nearestHeading = node.textContent.trim() || undefined
        }
        if (position >= start && position <= end) activeBlockIndex = index
      })

      anchor = {
        headingText: nearestHeading,
        blockIndex: view.state.doc.childCount > 0 ? activeBlockIndex : undefined,
      }
    })
    return anchor
  }

  restoreCursorAnchor(anchor: CursorAnchor): void {
    if (this.destroyed || !this.created) return

    this.crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const document = view.state.doc
      if (document.childCount === 0) return

      let targetIndex =
        anchor.blockIndex === undefined
          ? undefined
          : Math.max(0, Math.min(anchor.blockIndex, document.childCount - 1))
      if (targetIndex === undefined && anchor.headingText) {
        const headingIndexes: number[] = []
        document.forEach((node, _offset, index) => {
          if (node.type.name === 'heading' && node.textContent.trim() === anchor.headingText) {
            headingIndexes.push(index)
          }
        })
        if (headingIndexes.length > 0) {
          const expectedIndex = anchor.blockIndex ?? headingIndexes[0]!
          targetIndex = headingIndexes.reduce((nearest, index) =>
            Math.abs(index - expectedIndex) < Math.abs(nearest - expectedIndex) ? index : nearest,
          )
        }
      }
      targetIndex ??= 0

      let position = 1
      for (let index = 0; index < targetIndex; index += 1) {
        position += document.child(index).nodeSize
      }
      const selection = TextSelection.near(document.resolve(position), 1)
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
    })
  }

  scrollToHeading(id: string): boolean {
    if (this.destroyed || !this.created) return false
    return this.outlineFeature.controller.scrollToHeading(id)
  }

  async insertImageFromPicker(): Promise<void> {
    if (this.destroyed || !this.created) return
    this.finishProgrammaticUpdate()
    await this.imageFeature.insertFromPicker()
  }

  setDocumentPath(documentPath: string | undefined): void {
    this.imageFeature.setDocumentPath(documentPath)
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.programmaticUpdateGeneration += 1
    this.removeUserIntentListeners()
    this.unsubscribeOutline.splice(0).forEach((unsubscribe) => unsubscribe())
    // Milkdown leaves its status at OnCreate when create() rejects, and its
    // destroy() then retries forever. In that failure state the host removes
    // the partial DOM while this adapter releases its own listeners here.
    if (this.created) await this.destroyEditor()
  }

  private async destroyEditor(): Promise<void> {
    try {
      await this.crepe.destroy()
    } finally {
      this.created = false
    }
  }
}
