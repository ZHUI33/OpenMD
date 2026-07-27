import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  invertedEffects,
} from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  replaceAll as replaceAllSearchMatches,
  replaceNext,
  SearchQuery,
  search,
  searchKeymap,
  setSearchQuery,
} from '@codemirror/search'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import type { ChangeSet, Extension, StateEffectType, Text } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

import { createSourceCursorAnchor, resolveSourceCursorOffset } from './cursor-anchor'
import type {
  CursorAnchor,
  DocumentSearchQuery,
  DocumentSearchStatus,
  EditorDocumentAdapter,
  ResolvedTheme,
  SourceCursorPosition,
} from './editor.types'
import { RafCaretCenterer } from './writing-modes-feature'
import type { TypewriterBehavior } from '../../../shared/settings'

export interface MarkdownSourceEditorAdapterOptions {
  root: HTMLElement
  initialMarkdown: string
  readOnly: boolean
  lineNumbers: boolean
  lineWrapping: boolean
  theme: ResolvedTheme
  onChange: (markdown: string) => void
  onCursorChange?: (position: SourceCursorPosition) => void
  onSearchStatusChange?: (status: DocumentSearchStatus) => void
  focusMode?: boolean
  typewriterMode?: boolean
  typewriterBehavior?: TypewriterBehavior
}

function detectLineSeparator(markdownText: string): string {
  return markdownText.match(/\r\n|\r|\n/)?.[0] ?? '\n'
}

interface RawLine {
  from: number
  length: number
}

interface LineEndingSnapshot {
  markdown: string
  preferred: string
  overrides: ReadonlyMap<number, string>
}

function createLineEndingSnapshot(markdownText: string, preferred: string): LineEndingSnapshot {
  const overrides = new Map<number, string>()
  let lineBreakIndex = 0

  for (const match of markdownText.matchAll(/\r\n|\r|\n/g)) {
    const separator = match[0]
    if (separator !== preferred) overrides.set(lineBreakIndex, separator)
    lineBreakIndex += 1
  }

  return { markdown: markdownText, preferred, overrides }
}

function getRawLines(markdownText: string): RawLine[] {
  const lines: RawLine[] = []
  let from = 0

  for (const text of markdownText.split(/\r\n|\r|\n/)) {
    lines.push({ from, length: text.length })
    const lineBreak = markdownText.slice(from + text.length).match(/^(?:\r\n|\r|\n)/)?.[0]
    from += text.length + (lineBreak?.length ?? 0)
  }
  return lines
}

function toMarkdownOffset(
  state: EditorState,
  markdownText: string,
  internalOffset: number,
): number {
  const line = state.doc.lineAt(internalOffset)
  const rawLine = getRawLines(markdownText)[line.number - 1]
  if (!rawLine) return markdownText.length
  return rawLine.from + Math.min(internalOffset - line.from, rawLine.length)
}

function toInternalOffset(
  state: EditorState,
  markdownText: string,
  markdownOffset: number,
): number {
  const boundedOffset = Math.max(0, Math.min(markdownOffset, markdownText.length))
  const rawLines = getRawLines(markdownText)
  let lineIndex = rawLines.length - 1

  for (let index = 0; index < rawLines.length; index += 1) {
    const nextLine = rawLines[index + 1]
    if (!nextLine || boundedOffset < nextLine.from) {
      lineIndex = index
      break
    }
  }

  const rawLine = rawLines[lineIndex]!
  const line = state.doc.line(Math.min(lineIndex + 1, state.doc.lines))
  return line.from + Math.min(boundedOffset - rawLine.from, line.length)
}

function rawMarkdownOffset(
  state: EditorState,
  snapshot: LineEndingSnapshot,
  documentOffset: number,
): number {
  const bounded = Math.max(0, Math.min(documentOffset, state.doc.length))
  const precedingBreaks = state.doc.lineAt(bounded).number - 1
  let rawOffset = bounded + precedingBreaks * (snapshot.preferred.length - 1)
  for (const [lineBreakIndex, separator] of snapshot.overrides) {
    if (lineBreakIndex >= precedingBreaks) continue
    rawOffset += separator.length - snapshot.preferred.length
  }
  return rawOffset
}

function applyChangesToMarkdown(
  startState: EditorState,
  snapshot: LineEndingSnapshot,
  changes: ChangeSet,
): string {
  const markdownText = snapshot.markdown
  let rawCursor = 0
  let result = ''

  const appendFragment = (fragment: string): void => {
    // A lone CR followed by an LF denotes one CRLF separator, even when the
    // characters came from two different change fragments. Insert another CR
    // so two logical line breaks cannot accidentally collapse into one.
    if (result.endsWith('\r') && fragment.startsWith('\n')) result += '\r'
    result += fragment
  }

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const rawFrom = rawMarkdownOffset(startState, snapshot, fromA)
    const rawTo = rawMarkdownOffset(startState, snapshot, toA)
    appendFragment(markdownText.slice(rawCursor, rawFrom))
    appendFragment(inserted.toString().replace(/\n/g, snapshot.preferred))
    rawCursor = rawTo
  })

  appendFragment(markdownText.slice(rawCursor))

  return result
}

function changesLineStructure(state: EditorState, changes: ChangeSet): boolean {
  let changed = false
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.lines > 1 || state.doc.sliceString(fromA, toA).includes('\n')) changed = true
  })
  return changed
}

function sourceBaseTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        backgroundColor: 'var(--source-background)',
        color: 'var(--foreground)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': {
        fontFamily: 'var(--editor-font-family)',
        fontSize: 'var(--editor-font-size)',
        lineHeight: 'var(--editor-line-height)',
        overflow: 'auto',
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '44px 0 120px',
        caretColor: 'var(--primary)',
      },
      '.cm-line': { padding: '0 18px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)' },
      '.cm-gutters': {
        borderRight: '1px solid var(--border)',
        backgroundColor: 'var(--source-gutter-background)',
        color: 'var(--source-gutter-foreground)',
      },
      '.cm-activeLine': { backgroundColor: 'var(--source-active-line)' },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--source-active-line)',
        color: 'var(--foreground)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--source-selection) !important',
      },
      '.cm-foldPlaceholder': {
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface-subtle)',
        color: 'var(--muted)',
      },
      '.cm-panels': {
        borderColor: 'var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--foreground)',
      },
      '.cm-panel input, .cm-panel button': {
        border: '1px solid var(--border)',
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
      },
      '.cm-searchMatch': {
        outline: '1px solid var(--source-search-outline)',
        backgroundColor: 'var(--source-search)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'var(--source-search-selected)',
      },
    },
    { dark },
  )
}

function sourceTheme(theme: ResolvedTheme): Extension {
  if (theme === 'dark') return [oneDark, sourceBaseTheme(true)]
  return [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), sourceBaseTheme(false)]
}

function lineNumberExtensions(visible: boolean): Extension {
  return visible ? [lineNumbers(), highlightActiveLineGutter()] : []
}

function lineWrappingExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : []
}

function readOnlyExtensions(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

export class MarkdownSourceEditorAdapter implements EditorDocumentAdapter {
  private readonly lineNumbersCompartment = new Compartment()
  private readonly lineWrappingCompartment = new Compartment()
  private readonly readOnlyCompartment = new Compartment()
  private readonly themeCompartment = new Compartment()
  private view: EditorView | undefined
  private markdownDocument: Text | undefined
  private destroyed = false
  private markdown: string
  private lineNumbersVisible: boolean
  private lineWrappingEnabled: boolean
  private readOnly: boolean
  private theme: ResolvedTheme
  private lineSeparator: string
  private readonly restoreLineEndingsEffect: StateEffectType<LineEndingSnapshot>
  private readonly lineEndingsField: StateField<LineEndingSnapshot>
  private searchQuery = new SearchQuery({ search: '' })
  private lastSearchStatus: DocumentSearchStatus = { current: 0, total: 0 }
  private typewriterMode: boolean
  private typewriterBehavior: TypewriterBehavior
  private inputIntent = false
  private keyboardIntent = false
  private centerer?: RafCaretCenterer

  constructor(private readonly options: MarkdownSourceEditorAdapterOptions) {
    this.markdown = options.initialMarkdown
    this.lineNumbersVisible = options.lineNumbers
    this.lineWrappingEnabled = options.lineWrapping
    this.readOnly = options.readOnly
    this.theme = options.theme
    this.lineSeparator = detectLineSeparator(options.initialMarkdown)
    this.typewriterMode = options.typewriterMode ?? false
    this.typewriterBehavior = options.typewriterBehavior ?? 'input'
    this.restoreLineEndingsEffect = StateEffect.define<LineEndingSnapshot>({
      // When typing transactions are grouped into one history event, only the
      // oldest inverse snapshot is needed to restore the beginning of the group.
      map: () => undefined,
    })
    this.lineEndingsField = StateField.define<LineEndingSnapshot>({
      create: (state) => createLineEndingSnapshot(state.doc.toString(), '\n'),
      update: (snapshot, transaction) => {
        const restored = transaction.effects.find((effect) =>
          effect.is(this.restoreLineEndingsEffect),
        )
        if (restored) return restored.value
        if (!transaction.docChanged) return snapshot

        const markdownAfter = applyChangesToMarkdown(
          transaction.startState,
          snapshot,
          transaction.changes,
        )
        return changesLineStructure(transaction.startState, transaction.changes)
          ? createLineEndingSnapshot(markdownAfter, snapshot.preferred)
          : { ...snapshot, markdown: markdownAfter }
      },
    })
  }

  async create(): Promise<void> {
    if (this.destroyed || this.view) return

    this.view = new EditorView({
      parent: this.options.root,
      state: this.createEditorState(this.markdown),
    })
    this.markdownDocument = this.view.state.doc
    this.view.dom.addEventListener('beforeinput', this.onBeforeInput, true)
    this.view.dom.addEventListener('input', this.onTypewriterInput, true)
    this.view.dom.addEventListener('keydown', this.onTypewriterKeyDown, true)
    this.view.dom.addEventListener('pointerdown', this.onPointerDown, true)
    const ownerWindow = this.view.dom.ownerDocument.defaultView ?? window
    this.centerer = new RafCaretCenterer(ownerWindow, this.view.dom, () => {
      if (!this.view) return undefined
      return this.view.coordsAtPos(this.view.state.selection.main.head)?.top
    })
    this.emitCursorPosition(this.view.state)
    this.publishSearchStatus()
  }

  getMarkdown(): string {
    if (
      this.view &&
      !this.destroyed &&
      (!this.markdownDocument || !this.markdownDocument.eq(this.view.state.doc))
    ) {
      this.markdown = this.serializeState(this.view.state)
      this.markdownDocument = this.view.state.doc
    }
    return this.markdown
  }

  setMarkdown(markdownText: string): void {
    if (this.destroyed) return
    this.markdown = markdownText
    this.lineSeparator = detectLineSeparator(markdownText)
    if (!this.view) return

    // Opening or creating a document must also reset the undo history. setState
    // performs a true document replacement and does not emit an onChange loop.
    const state = this.createEditorState(markdownText)
    this.view.setState(state)
    this.markdownDocument = state.doc
    this.emitCursorPosition(state)
  }

  focus(): void {
    if (!this.destroyed) this.view?.focus()
  }

  getCursorAnchor(): CursorAnchor | undefined {
    if (!this.view || this.destroyed) return undefined
    const markdownText = this.getMarkdown()
    const offset = toMarkdownOffset(
      this.view.state,
      markdownText,
      this.view.state.selection.main.head,
    )
    return createSourceCursorAnchor(markdownText, offset)
  }

  restoreCursorAnchor(anchor: CursorAnchor): void {
    if (!this.view || this.destroyed) return
    const markdownText = this.getMarkdown()
    const markdownOffset = resolveSourceCursorOffset(markdownText, anchor)
    const offset = toInternalOffset(this.view.state, markdownText, markdownOffset)
    this.view.dispatch({ selection: { anchor: offset }, scrollIntoView: true })
  }

  setSearchQuery(query: DocumentSearchQuery): void {
    if (!this.view || this.destroyed) return
    this.searchQuery = new SearchQuery({
      search: query.query,
      caseSensitive: query.caseSensitive,
      regexp: query.regularExpression,
      wholeWord: query.wholeWord,
      replace: query.replacement,
      literal: !query.regularExpression,
    })
    this.view.dispatch({ effects: setSearchQuery.of(this.searchQuery) })
    this.publishSearchStatus()
  }

  findNext(direction: 1 | -1 = 1): void {
    if (!this.view || this.destroyed) return
    const matches = this.getSearchMatches()
    if (matches.length === 0) return
    const selection = this.view.state.selection.main
    let currentIndex = matches.findIndex(
      (match) => match.from === selection.from && match.to === selection.to,
    )
    if (currentIndex < 0) {
      currentIndex = matches.findIndex((match) => match.from >= selection.from)
      if (currentIndex < 0) currentIndex = 0
    }
    const targetIndex = (currentIndex + direction + matches.length) % matches.length
    const target = matches[targetIndex]!
    this.view.dispatch({
      selection: { anchor: target.from, head: target.to },
      effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
    })
    this.publishSearchStatus()
  }

  replaceCurrent(): void {
    if (!this.view || this.destroyed) return
    replaceNext(this.view)
    this.publishSearchStatus()
  }

  replaceAll(): void {
    if (!this.view || this.destroyed) return
    replaceAllSearchMatches(this.view)
    this.publishSearchStatus()
  }

  clearSearch(): void {
    if (!this.view || this.destroyed) return
    this.searchQuery = new SearchQuery({ search: '' })
    this.view.dispatch({ effects: setSearchQuery.of(this.searchQuery) })
    this.publishSearchStatus()
  }

  setWritingModes(
    focusMode: boolean,
    typewriterMode: boolean,
    typewriterBehavior: TypewriterBehavior,
  ): void {
    void focusMode
    this.typewriterMode = typewriterMode
    this.typewriterBehavior = typewriterBehavior
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly
    this.view?.dispatch({
      effects: this.readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)),
    })
  }

  setLineNumbers(visible: boolean): void {
    this.lineNumbersVisible = visible
    this.view?.dispatch({
      effects: this.lineNumbersCompartment.reconfigure(lineNumberExtensions(visible)),
    })
  }

  setLineWrapping(enabled: boolean): void {
    this.lineWrappingEnabled = enabled
    this.view?.dispatch({
      effects: this.lineWrappingCompartment.reconfigure(lineWrappingExtension(enabled)),
    })
  }

  setTheme(theme: ResolvedTheme): void {
    this.theme = theme
    this.view?.dispatch({ effects: this.themeCompartment.reconfigure(sourceTheme(theme)) })
  }

  async whenStable(): Promise<void> {
    await Promise.resolve()
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.getMarkdown()
    this.destroyed = true
    this.view?.dom.removeEventListener('beforeinput', this.onBeforeInput, true)
    this.view?.dom.removeEventListener('input', this.onTypewriterInput, true)
    this.view?.dom.removeEventListener('keydown', this.onTypewriterKeyDown, true)
    this.view?.dom.removeEventListener('pointerdown', this.onPointerDown, true)
    this.centerer?.cancel()
    this.centerer = undefined
    this.view?.destroy()
    this.view = undefined
  }

  private emitCursorPosition(state: EditorState): void {
    const offset = state.selection.main.head
    const line = state.doc.lineAt(offset)
    const column = Array.from(state.sliceDoc(line.from, offset)).length + 1
    this.options.onCursorChange?.({ line: line.number, column })
  }

  private publishSearchStatus(): void {
    const view = this.view
    const matches = this.getSearchMatches()
    const selection = view?.state.selection.main
    let currentIndex = selection
      ? matches.findIndex((match) => match.from === selection.from && match.to === selection.to)
      : -1
    if (currentIndex < 0 && selection && matches.length > 0) {
      currentIndex = matches.findIndex((match) => match.from >= selection.from)
      if (currentIndex < 0) currentIndex = 0
    }
    const status: DocumentSearchStatus = {
      current: currentIndex >= 0 ? currentIndex + 1 : 0,
      total: matches.length,
      error: this.searchQuery.valid ? undefined : '正则表达式无效。',
    }
    if (
      status.current === this.lastSearchStatus.current &&
      status.total === this.lastSearchStatus.total &&
      status.error === this.lastSearchStatus.error
    ) {
      return
    }
    this.lastSearchStatus = status
    this.options.onSearchStatusChange?.(status)
  }

  private getSearchMatches(): Array<{ from: number; to: number }> {
    const matches: Array<{ from: number; to: number }> = []
    if (!this.view || !this.searchQuery.valid) return matches
    const cursor = this.searchQuery.getCursor(this.view.state)
    for (let next = cursor.next(); !next.done; next = cursor.next()) matches.push(next.value)
    return matches
  }

  private readonly onBeforeInput = (): void => {
    this.inputIntent = true
  }

  private readonly onTypewriterInput = (): void => {
    if (this.typewriterMode) this.centerer?.schedule()
  }

  private readonly onTypewriterKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key.startsWith('Arrow') ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown'
    ) {
      this.keyboardIntent = true
    }
  }

  private readonly onPointerDown = (): void => {
    this.inputIntent = false
    this.keyboardIntent = false
  }

  private createEditorState(markdownText: string): EditorState {
    return EditorState.create({
      doc: markdownText,
      extensions: [
        this.lineEndingsField.init(() =>
          createLineEndingSnapshot(markdownText, this.lineSeparator),
        ),
        invertedEffects.of((transaction) =>
          transaction.docChanged
            ? [
                this.restoreLineEndingsEffect.of(
                  transaction.startState.field(this.lineEndingsField),
                ),
              ]
            : [],
        ),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        markdown({ codeLanguages: languages }),
        search({ top: true }),
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        this.lineNumbersCompartment.of(lineNumberExtensions(this.lineNumbersVisible)),
        this.lineWrappingCompartment.of(lineWrappingExtension(this.lineWrappingEnabled)),
        this.readOnlyCompartment.of(readOnlyExtensions(this.readOnly)),
        this.themeCompartment.of(sourceTheme(this.theme)),
        EditorView.updateListener.of((update) => {
          if (this.destroyed) return

          if (update.docChanged) {
            this.markdown = update.state.field(this.lineEndingsField).markdown
            this.markdownDocument = update.state.doc
            this.options.onChange(this.markdown)
          }
          if (update.docChanged || update.selectionSet) this.emitCursorPosition(update.state)
          const shouldCenter =
            this.typewriterMode &&
            ((update.docChanged && (this.inputIntent || update.view.hasFocus)) ||
              (this.typewriterBehavior === 'always' && update.selectionSet && this.keyboardIntent))
          this.inputIntent = false
          this.keyboardIntent = false
          if (shouldCenter) this.centerer?.schedule()
          if (update.docChanged || update.selectionSet) this.publishSearchStatus()
        }),
      ],
    })
  }

  private serializeState(state: EditorState): string {
    return state.field(this.lineEndingsField).markdown
  }
}
