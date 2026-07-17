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
import { search, searchKeymap } from '@codemirror/search'
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
  EditorDocumentAdapter,
  ResolvedTheme,
  SourceCursorPosition,
} from './editor.types'

export interface MarkdownSourceEditorAdapterOptions {
  root: HTMLElement
  initialMarkdown: string
  readOnly: boolean
  lineNumbers: boolean
  lineWrapping: boolean
  theme: ResolvedTheme
  onChange: (markdown: string) => void
  onCursorChange?: (position: SourceCursorPosition) => void
}

function detectLineSeparator(markdownText: string): string {
  return markdownText.match(/\r\n|\r|\n/)?.[0] ?? '\n'
}

interface RawLine {
  from: number
  length: number
}

interface LineEndingSnapshot {
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

  return { preferred, overrides }
}

function serializeTextWithLineEndings(document: Text, snapshot: LineEndingSnapshot): string {
  let lineBreakIndex = 0
  return document.toString().replace(/\n/g, () => {
    const separator = snapshot.overrides.get(lineBreakIndex) ?? snapshot.preferred
    lineBreakIndex += 1
    return separator
  })
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

function applyChangesToMarkdown(
  startState: EditorState,
  markdownText: string,
  changes: ChangeSet,
  lineSeparator: string,
): string {
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
    const rawFrom = toMarkdownOffset(startState, markdownText, fromA)
    const rawTo = toMarkdownOffset(startState, markdownText, toA)
    appendFragment(markdownText.slice(rawCursor, rawFrom))
    appendFragment(inserted.toString().replace(/\n/g, lineSeparator))
    rawCursor = rawTo
  })

  appendFragment(markdownText.slice(rawCursor))

  const normalizedResult = result.replace(/\r\n|\r/g, '\n')
  const expectedResult = changes.apply(startState.doc).toString()
  return normalizedResult === expectedResult ? result : expectedResult.replace(/\n/g, lineSeparator)
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

  constructor(private readonly options: MarkdownSourceEditorAdapterOptions) {
    this.markdown = options.initialMarkdown
    this.lineNumbersVisible = options.lineNumbers
    this.lineWrappingEnabled = options.lineWrapping
    this.readOnly = options.readOnly
    this.theme = options.theme
    this.lineSeparator = detectLineSeparator(options.initialMarkdown)
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

        const markdownBefore = serializeTextWithLineEndings(transaction.startState.doc, snapshot)
        const markdownAfter = applyChangesToMarkdown(
          transaction.startState,
          markdownBefore,
          transaction.changes,
          snapshot.preferred,
        )
        return createLineEndingSnapshot(markdownAfter, snapshot.preferred)
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
    this.emitCursorPosition(this.view.state)
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
    this.view?.destroy()
    this.view = undefined
  }

  private emitCursorPosition(state: EditorState): void {
    const offset = state.selection.main.head
    const line = state.doc.lineAt(offset)
    const column = Array.from(state.sliceDoc(line.from, offset)).length + 1
    this.options.onCursorChange?.({ line: line.number, column })
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
            this.markdown = this.serializeState(update.state)
            this.markdownDocument = update.state.doc
            this.options.onChange(this.markdown)
          }
          if (update.docChanged || update.selectionSet) this.emitCursorPosition(update.state)
        }),
      ],
    })
  }

  private serializeState(state: EditorState): string {
    return serializeTextWithLineEndings(state.doc, state.field(this.lineEndingsField))
  }
}
