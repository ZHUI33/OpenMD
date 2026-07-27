import type { RendererImagesApi } from './image-feature'
import type { OutlineItem } from './outline-feature'
import type { TypewriterBehavior } from '../../../shared/settings'

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

export interface DocumentSearchQuery {
  query: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  regularExpression: boolean
}

export interface DocumentSearchStatus {
  current: number
  total: number
  error?: string
}

export interface EditorDocumentAdapter {
  getMarkdown(): string
  setMarkdown(markdown: string): void
  focus(): void
  getCursorAnchor?(): CursorAnchor | undefined
  restoreCursorAnchor?(anchor: CursorAnchor): void
  setSearchQuery?(query: DocumentSearchQuery): void
  findNext?(direction?: 1 | -1): void
  replaceCurrent?(): void
  replaceAll?(): void
  clearSearch?(): void
  setWritingModes?(focusMode: boolean, typewriterMode: boolean, behavior: TypewriterBehavior): void
}

export interface OpenMdEditorHandle extends EditorDocumentAdapter {
  setReadOnly(readOnly: boolean): void
  insertImageFromPicker(): Promise<void>
  getMode(): EditorMode
  setMode(mode: EditorMode): Promise<void>
  toggleMode(): Promise<void>
  toggleSourceLineNumbers(): void
  toggleSourceLineWrapping(): void
  setSearchQuery(query: DocumentSearchQuery): void
  findNext(direction?: 1 | -1): void
  replaceCurrent(): void
  replaceAll(): void
  clearSearch(): void
  setWritingModes(focusMode: boolean, typewriterMode: boolean, behavior: TypewriterBehavior): void
  getScrollPosition?(): number
  setScrollPosition?(position: number): void
  revealLine?(line: number): void
  scrollToHeading?(id: string): boolean
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
  onOutlineChange?: (outline: readonly OutlineItem[]) => void
  onActiveHeadingChange?: (id: string | null) => void
  onSearchStatusChange?: (status: DocumentSearchStatus) => void
  focusMode?: boolean
  typewriterMode?: boolean
  typewriterBehavior?: TypewriterBehavior
  onError?: (message: string) => void
}
