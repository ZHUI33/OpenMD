import { beforeEach, describe, expect, it } from 'vitest'

import {
  WELCOME_MARKDOWN,
  countCharacters,
  countWords,
  useAppStore,
} from '../src/renderer/src/stores/app-store'

function resetStore(): void {
  useAppStore.setState({
    theme: 'system',
    sidebarVisible: false,
    editorMode: 'visual',
    sourceLineNumbers: true,
    sourceLineWrapping: true,
    sourceCursor: { line: 1, column: 1 },
    document: {
      markdown: WELCOME_MARKDOWN,
      savedMarkdown: WELCOME_MARKDOWN,
      filePath: undefined,
      dirty: false,
      wordCount: countWords(WELCOME_MARKDOWN),
      characterCount: countCharacters(WELCOME_MARKDOWN),
    },
  })
}

describe('app store', () => {
  beforeEach(resetStore)

  it('uses the required initial application state', () => {
    const state = useAppStore.getState()

    expect(state.theme).toBe('system')
    expect(state.sidebarVisible).toBe(false)
    expect(state.editorMode).toBe('visual')
    expect(state.sourceLineNumbers).toBe(true)
    expect(state.sourceLineWrapping).toBe(true)
    expect(state.sourceCursor).toEqual({ line: 1, column: 1 })
    expect(state.document.markdown).toBe(WELCOME_MARKDOWN)
    expect(state.document.savedMarkdown).toBe(WELCOME_MARKDOWN)
    expect(state.document.filePath).toBeUndefined()
    expect(state.document.dirty).toBe(false)
  })

  it('updates the theme', () => {
    useAppStore.getState().setTheme('dark')

    expect(useAppStore.getState().theme).toBe('dark')
  })

  it('toggles sidebar visibility', () => {
    useAppStore.getState().toggleSidebar()

    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('updates editor mode, source preferences, and cursor independently of the document', () => {
    useAppStore.getState().setEditorMode('source')
    useAppStore.getState().setSourceLineNumbers(false)
    useAppStore.getState().setSourceLineWrapping(false)
    useAppStore.getState().setSourceCursor({ line: 8, column: 3 })

    expect(useAppStore.getState()).toMatchObject({
      editorMode: 'source',
      sourceLineNumbers: false,
      sourceLineWrapping: false,
      sourceCursor: { line: 8, column: 3 },
    })
    expect(useAppStore.getState().document.dirty).toBe(false)
  })

  it('counts Chinese characters and English words', () => {
    expect(countWords('你好 OpenMD editor 2026')).toBe(5)
  })

  it('counts Unicode characters rather than UTF-16 code units', () => {
    expect(countCharacters('OpenMD 中文 🚀')).toBe(11)
  })

  it('updates document statistics and dirty state', () => {
    useAppStore.getState().updateMarkdown('# 新文档\n\nHello world')

    const document = useAppStore.getState().document
    expect(document.markdown).toBe('# 新文档\n\nHello world')
    expect(document.dirty).toBe(true)
    expect(document.wordCount).toBe(5)
    expect(document.characterCount).toBe(18)
  })

  it('becomes clean again when content returns to the saved Markdown', () => {
    useAppStore.getState().setDocument('saved', 'C:\\notes\\draft.md')
    useAppStore.getState().updateMarkdown('changed')
    useAppStore.getState().updateMarkdown('saved')

    expect(useAppStore.getState().document.dirty).toBe(false)
  })

  it('initializes a loaded Markdown document and path as clean', () => {
    useAppStore.getState().setDocument('## Initial Markdown', 'C:\\notes\\initial.md')

    expect(useAppStore.getState().document).toEqual({
      markdown: '## Initial Markdown',
      savedMarkdown: '## Initial Markdown',
      filePath: 'C:\\notes\\initial.md',
      dirty: false,
      wordCount: 2,
      characterCount: 19,
    })
  })

  it('creates a clean blank document without a file path', () => {
    useAppStore.getState().setDocument('old content', 'C:\\notes\\old.md')
    useAppStore.getState().setDocument('')

    expect(useAppStore.getState().document).toEqual({
      markdown: '',
      savedMarkdown: '',
      filePath: undefined,
      dirty: false,
      wordCount: 0,
      characterCount: 0,
    })
  })

  it('marks the saved snapshot clean and updates the path after a successful save', () => {
    useAppStore.getState().setDocument('original', 'C:\\notes\\old.md')
    useAppStore.getState().updateMarkdown('updated')

    useAppStore
      .getState()
      .applySaveResult({ canceled: false, filePath: 'C:\\notes\\renamed.md' }, 'updated')

    expect(useAppStore.getState().document).toMatchObject({
      markdown: 'updated',
      savedMarkdown: 'updated',
      filePath: 'C:\\notes\\renamed.md',
      dirty: false,
    })
  })

  it('leaves content, path, and dirty state unchanged when saving is canceled', () => {
    useAppStore.getState().setDocument('original', 'C:\\notes\\draft.md')
    useAppStore.getState().updateMarkdown('unsaved')
    const beforeCancel = useAppStore.getState().document

    useAppStore.getState().applySaveResult({ canceled: true }, 'unsaved')

    expect(useAppStore.getState().document).toEqual(beforeCancel)
  })

  it('keeps the document dirty after a failed save', () => {
    useAppStore.getState().setDocument('original', 'C:\\notes\\draft.md')
    useAppStore.getState().updateMarkdown('unsaved')

    useAppStore.getState().applySaveResult({ canceled: false, error: true }, 'unsaved')

    expect(useAppStore.getState().document).toMatchObject({
      markdown: 'unsaved',
      savedMarkdown: 'original',
      filePath: 'C:\\notes\\draft.md',
      dirty: true,
    })
  })

  it('keeps later edits dirty when a previous snapshot finishes saving', () => {
    useAppStore.getState().setDocument('original', 'C:\\notes\\draft.md')
    useAppStore.getState().updateMarkdown('submitted snapshot')
    useAppStore.getState().updateMarkdown('edited while saving')

    useAppStore
      .getState()
      .applySaveResult({ canceled: false, filePath: 'C:\\notes\\draft.md' }, 'submitted snapshot')

    expect(useAppStore.getState().document).toMatchObject({
      markdown: 'edited while saving',
      savedMarkdown: 'submitted snapshot',
      filePath: 'C:\\notes\\draft.md',
      dirty: true,
    })
  })
})
