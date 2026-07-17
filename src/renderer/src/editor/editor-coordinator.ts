import type { CursorAnchor, EditorDocumentAdapter, EditorMode } from './editor.types'

export interface EditorModeCoordinatorOptions {
  initialMarkdown: string
  initialMode?: EditorMode
  onChange?: (markdown: string) => void
}

interface ActiveEditor {
  adapter: EditorDocumentAdapter
  mode: EditorMode
}

/**
 * Owns the single canonical Markdown snapshot while concrete editors are
 * created and destroyed. It deliberately knows nothing about React or editor
 * lifecycles, which makes stale callbacks and transition-time saves easy to
 * reject deterministically.
 */
export class EditorModeCoordinator {
  private activeEditor: ActiveEditor | undefined
  private cursorAnchor: CursorAnchor | undefined
  private markdown: string
  private mode: EditorMode

  constructor(private readonly options: EditorModeCoordinatorOptions) {
    this.markdown = options.initialMarkdown
    this.mode = options.initialMode ?? 'visual'
  }

  getMode(): EditorMode {
    return this.mode
  }

  hasActiveEditor(): boolean {
    return this.activeEditor !== undefined
  }

  getSnapshot(): string {
    return this.markdown
  }

  getMarkdown(): string {
    this.syncActiveEditor()
    return this.markdown
  }

  setMarkdown(markdown: string): void {
    this.markdown = markdown
    this.cursorAnchor = undefined
    this.activeEditor?.adapter.setMarkdown(markdown)
  }

  focus(): void {
    this.activeEditor?.adapter.focus()
  }

  attach(mode: EditorMode, adapter: EditorDocumentAdapter): boolean {
    if (mode !== this.mode) return false

    this.activeEditor = { adapter, mode }
    if (adapter.getMarkdown() !== this.markdown) adapter.setMarkdown(this.markdown)
    return true
  }

  markReady(adapter: EditorDocumentAdapter): void {
    if (this.activeEditor?.adapter !== adapter) return

    if (this.cursorAnchor) adapter.restoreCursorAnchor?.(this.cursorAnchor)
    adapter.focus()
  }

  detach(adapter: EditorDocumentAdapter, sync = true): void {
    if (this.activeEditor?.adapter !== adapter) return

    if (sync) this.syncActiveEditor()
    this.activeEditor = undefined
  }

  switchMode(mode: EditorMode): boolean {
    if (mode === this.mode) return false

    const active = this.activeEditor
    if (active) {
      this.syncActiveEditor()
      this.cursorAnchor = active.adapter.getCursorAnchor?.()
      this.activeEditor = undefined
    }
    this.mode = mode
    return true
  }

  acceptChange(adapter: EditorDocumentAdapter, markdown: string): boolean {
    if (this.activeEditor?.adapter !== adapter || markdown === this.markdown) return false

    this.markdown = markdown
    this.options.onChange?.(markdown)
    return true
  }

  private syncActiveEditor(): void {
    const active = this.activeEditor
    if (!active) return

    const markdown = active.adapter.getMarkdown()
    if (markdown === this.markdown) return

    this.markdown = markdown
    this.options.onChange?.(markdown)
  }
}
