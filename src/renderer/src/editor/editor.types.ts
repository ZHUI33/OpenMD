export interface OpenMdEditorHandle {
  getMarkdown(): string
  setMarkdown(markdown: string): void
  focus(): void
}

export interface OpenMdEditorProps {
  initialMarkdown?: string
  readOnly?: boolean
  onChange?: (markdown: string) => void
}
