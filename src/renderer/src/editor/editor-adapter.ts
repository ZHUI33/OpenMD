import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'

export interface EditorAdapterOptions {
  root: HTMLElement
  initialMarkdown: string
  readOnly: boolean
  onChange: (markdown: string) => void
}

export class OpenMdEditorAdapter {
  private readonly crepe: Crepe
  private markdown: string
  private applyingMarkdown = false
  private destroyed = false
  private created = false

  constructor(options: EditorAdapterOptions) {
    this.markdown = options.initialMarkdown
    this.crepe = new Crepe({
      root: options.root,
      defaultValue: options.initialMarkdown,
      features: {
        [CrepeFeature.Toolbar]: false,
        [CrepeFeature.ImageBlock]: false,
        [CrepeFeature.Table]: false,
        [CrepeFeature.Latex]: false,
      },
      featureConfigs: {
        [CrepeFeature.Placeholder]: { text: '开始写作…' },
      },
    })

    this.crepe.setReadonly(options.readOnly).on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        this.markdown = markdown
        if (!this.applyingMarkdown) options.onChange(markdown)
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
    if (this.crepe.getMarkdown() !== this.markdown) this.applyMarkdown(this.markdown)
  }

  getMarkdown(): string {
    return this.markdown
  }

  setMarkdown(markdown: string): void {
    if (markdown === this.markdown || this.destroyed) return

    this.markdown = markdown
    if (this.created) this.applyMarkdown(markdown)
  }

  private applyMarkdown(markdown: string): void {
    this.applyingMarkdown = true
    this.crepe.editor.action(replaceAll(markdown, true))
    queueMicrotask(() => {
      this.applyingMarkdown = false
    })
  }

  setReadOnly(readOnly: boolean): void {
    this.crepe.setReadonly(readOnly)
  }

  focus(): void {
    if (this.destroyed || !this.created) return
    this.crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
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
