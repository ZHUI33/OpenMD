import type { RendererImagesApi } from './image-feature'

export interface OpenMdEditorHandle {
  getMarkdown(): string
  setMarkdown(markdown: string): void
  setReadOnly(readOnly: boolean): void
  focus(): void
  insertImageFromPicker(): Promise<void>
}

export interface OpenMdEditorProps {
  initialMarkdown?: string
  readOnly?: boolean
  onChange?: (markdown: string) => void
  documentPath?: string
  imagesApi?: RendererImagesApi
  onEnsureDocumentSaved?: () => Promise<string | undefined>
}
