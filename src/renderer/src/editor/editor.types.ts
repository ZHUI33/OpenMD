import type { RendererImagesApi } from './image-feature'

export type EditorMode = 'visual' | 'source'

export type ResolvedTheme = 'light' | 'dark'

export interface CursorAnchor {
  offset?: number
  headingText?: string
  blockIndex?: number
}

export interface SourceCursorPosition {
  line: number
  column: number
}

export interface EditorDocumentAdapter {
  getMarkdown(): string
  setMarkdown(markdown: string): void
  focus(): void
  getCursorAnchor?(): CursorAnchor | undefined
  restoreCursorAnchor?(anchor: CursorAnchor): void
}

export interface OpenMdEditorHandle extends EditorDocumentAdapter {
  setReadOnly(readOnly: boolean): void
  insertImageFromPicker(): Promise<void>
  getMode(): EditorMode
  setMode(mode: EditorMode): Promise<void>
  toggleMode(): Promise<void>
  toggleSourceLineNumbers(): void
  toggleSourceLineWrapping(): void
  getScrollPosition?(): number
  setScrollPosition?(position: number): void
  revealLine?(line: number): void
  whenIdle(): Promise<void>
}

export interface OpenMdEditorProps {
  initialMarkdown?: string
  initialMode?: EditorMode
  readOnly?: boolean
  onChange?: (markdown: string) => void
  onModeChange?: (mode: EditorMode) => void
  onSourceCursorChange?: (position: SourceCursorPosition) => void
  initialSourceLineNumbers?: boolean
  initialSourceLineWrapping?: boolean
  onSourceLineNumbersChange?: (visible: boolean) => void
  onSourceLineWrappingChange?: (enabled: boolean) => void
  resolvedTheme?: ResolvedTheme
  documentPath?: string
  imagesApi?: RendererImagesApi
  onEnsureDocumentSaved?: () => Promise<string | undefined>
}
