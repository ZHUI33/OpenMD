import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'
import type { Node as ProseMirrorNode } from '@milkdown/prose/model'

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
import { openMdTableFeatures, openMdTablePlugins } from './table-feature'

export interface EditorAdapterOptions {
  root: HTMLElement
  initialMarkdown: string
  readOnly: boolean
  onChange: (markdown: string) => void
  imagesApi?: RendererImagesApi
  getDocumentPath?: () => string | undefined
  onEnsureDocumentSaved?: () => Promise<string | undefined>
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

export class OpenMdEditorAdapter {
  private readonly crepe: Crepe
  private readonly imageFeature: ReturnType<typeof createOpenMdImageFeature>
  private markdown: string
  private markdownDocument: ProseMirrorNode | null = null
  private programmaticDocument: ProseMirrorNode | null = null
  private destroyed = false
  private created = false

  constructor(options: EditorAdapterOptions) {
    this.markdown = options.initialMarkdown
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
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.ListItem]: true,
        [CrepeFeature.LinkTooltip]: false,
        [CrepeFeature.BlockEdit]: true,
        [CrepeFeature.Toolbar]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Latex]: false,
      },
      featureConfigs: {
        [CrepeFeature.Placeholder]: { text: '开始写作…' },
        [CrepeFeature.BlockEdit]: openMdInsertMenuConfig,
      },
    })
    this.crepe.editor.config(configureOpenMdCodeBlocks)
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

    this.crepe.setReadonly(options.readOnly).on((listener) => {
      listener.markdownUpdated((ctx, markdown) => {
        const state = ctx.get(editorViewCtx).state
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
    if (this.crepe.getMarkdown() !== this.markdown) {
      this.applyMarkdown(this.markdown)
    } else {
      this.captureMarkdownDocument()
    }
  }

  getMarkdown(): string {
    if (!this.created || this.destroyed) return this.markdown

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
    if (markdown === this.markdown && this.currentDocumentMatchesMarkdown()) return

    this.markdown = markdown
    if (this.created) this.applyMarkdown(markdown)
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

  private currentDocumentMatchesMarkdown(): boolean {
    if (!this.created) return true

    let matches = false
    this.crepe.editor.action((ctx) => {
      matches = this.markdownDocument?.eq(ctx.get(editorViewCtx).state.doc) ?? false
    })
    return matches
  }

  setReadOnly(readOnly: boolean): void {
    this.crepe.setReadonly(readOnly)
  }

  focus(): void {
    if (this.destroyed || !this.created) return
    this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
  }

  async insertImageFromPicker(): Promise<void> {
    if (this.destroyed || !this.created) return
    await this.imageFeature.insertFromPicker()
  }

  setDocumentPath(documentPath: string | undefined): void {
    this.imageFeature.setDocumentPath(documentPath)
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    if (this.created) await this.destroyEditor()
  }

  private async destroyEditor(): Promise<void> {
    await this.crepe.destroy()
    this.created = false
  }
}
