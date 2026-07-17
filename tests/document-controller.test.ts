import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentController } from '../src/renderer/src/document-controller'
import type { OpenMdEditorHandle } from '../src/renderer/src/editor/editor.types'
import { countCharacters, countWords, useAppStore } from '../src/renderer/src/stores/app-store'
import type { DocumentsApi, SaveDocumentResult } from '../src/shared/desktop-api.types'

function createDocumentsApi(): DocumentsApi {
  return {
    ready: vi.fn(() => Promise.resolve()),
    newDocument: vi.fn(() => Promise.resolve({ content: '' })),
    openDocument: vi.fn(() => Promise.resolve({ canceled: true })),
    saveDocument: vi.fn(() => Promise.resolve({ canceled: true })),
    confirmClose: vi.fn(() => Promise.resolve({ action: 'discard' as const })),
    releaseDocument: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve()),
    resolveClose: vi.fn(() => Promise.resolve()),
    onCommand: vi.fn(() => () => undefined),
  }
}

function setDocument(markdown: string, filePath: string, dirtyMarkdown?: string): void {
  useAppStore.setState({
    theme: 'system',
    sidebarVisible: false,
    editorMode: 'visual',
    sourceLineNumbers: true,
    sourceLineWrapping: true,
    sourceCursor: { line: 1, column: 1 },
    document: {
      markdown: dirtyMarkdown ?? markdown,
      savedMarkdown: markdown,
      filePath,
      dirty: dirtyMarkdown !== undefined && dirtyMarkdown !== markdown,
      wordCount: countWords(dirtyMarkdown ?? markdown),
      characterCount: countCharacters(dirtyMarkdown ?? markdown),
    },
  })
}

describe('document controller', () => {
  let api: DocumentsApi
  let editorMarkdown: string
  let editor: OpenMdEditorHandle
  let controller: DocumentController

  beforeEach(() => {
    api = createDocumentsApi()
    editorMarkdown = 'unsaved content'
    editor = {
      getMarkdown: vi.fn(() => editorMarkdown),
      setMarkdown: vi.fn((markdown) => {
        editorMarkdown = markdown
      }),
      setReadOnly: vi.fn(),
      focus: vi.fn(),
      insertImageFromPicker: vi.fn(async () => undefined),
      getMode: vi.fn(() => 'visual' as const),
      setMode: vi.fn(async () => undefined),
      toggleMode: vi.fn(async () => undefined),
      toggleSourceLineNumbers: vi.fn(),
      toggleSourceLineWrapping: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
    }
    controller = new DocumentController(api, () => editor)
    setDocument('saved content', 'C:\\notes\\draft.md', editorMarkdown)
  })

  it.each(['new', 'open'] as const)(
    'does not execute %s when replacement confirmation is canceled',
    async (type) => {
      vi.mocked(api.confirmClose).mockResolvedValue({ action: 'cancel' })

      await controller.handleCommand({ type })

      expect(api.confirmClose).toHaveBeenCalledWith({
        filePath: 'C:\\notes\\draft.md',
        content: 'unsaved content',
      })
      expect(api.newDocument).not.toHaveBeenCalled()
      expect(api.openDocument).not.toHaveBeenCalled()
      expect(useAppStore.getState().document).toMatchObject({
        markdown: 'unsaved content',
        filePath: 'C:\\notes\\draft.md',
        dirty: true,
      })
    },
  )

  it('resolves a canceled close request with proceed=false', async () => {
    vi.mocked(api.confirmClose).mockResolvedValue({ action: 'cancel' })

    await controller.handleCommand({ type: 'close', intent: 'window', requestId: 'close-1' })

    expect(api.resolveClose).toHaveBeenCalledWith({
      intent: 'window',
      requestId: 'close-1',
      proceed: false,
    })
  })

  it('opens a document into the current source mode without changing modes', async () => {
    vi.mocked(editor.getMode).mockReturnValue('source')
    vi.mocked(api.openDocument).mockResolvedValue({
      canceled: false,
      filePath: 'C:\\notes\\opened.md',
      content: '# 已打开\n\n源码内容',
    })

    await controller.handleCommand({ type: 'open' })

    expect(editor.setMarkdown).toHaveBeenCalledWith('# 已打开\n\n源码内容')
    expect(editor.toggleMode).not.toHaveBeenCalled()
    expect(editor.getMode()).toBe('source')
    expect(useAppStore.getState().document).toMatchObject({
      markdown: '# 已打开\n\n源码内容',
      savedMarkdown: '# 已打开\n\n源码内容',
      filePath: 'C:\\notes\\opened.md',
      dirty: false,
    })
  })

  it('creates a clean empty document while remaining in source mode', async () => {
    vi.mocked(editor.getMode).mockReturnValue('source')
    vi.mocked(api.newDocument).mockResolvedValue({ content: '' })

    await controller.handleCommand({ type: 'new' })

    expect(editor.setMarkdown).toHaveBeenCalledWith('')
    expect(editor.toggleMode).not.toHaveBeenCalled()
    expect(editor.getMode()).toBe('source')
    expect(useAppStore.getState().document).toMatchObject({
      markdown: '',
      savedMarkdown: '',
      filePath: undefined,
      dirty: false,
    })
  })

  it('keeps content, path, and dirty state when the save dialog is canceled', async () => {
    vi.mocked(api.saveDocument).mockResolvedValue({ canceled: true })
    const beforeSave = useAppStore.getState().document

    await controller.handleCommand({ type: 'save' })

    expect(api.saveDocument).toHaveBeenCalledWith({
      filePath: 'C:\\notes\\draft.md',
      content: 'unsaved content',
      saveAs: false,
    })
    expect(useAppStore.getState().document).toEqual(beforeSave)
  })

  it('keeps a document dirty when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(api.saveDocument).mockRejectedValue(new Error('disk full'))

    await expect(controller.handleCommand({ type: 'save' })).rejects.toThrow('disk full')

    expect(useAppStore.getState().document).toMatchObject({
      markdown: 'unsaved content',
      savedMarkdown: 'saved content',
      filePath: 'C:\\notes\\draft.md',
      dirty: true,
    })
  })

  it('preserves edits made while an earlier snapshot is being saved', async () => {
    let finishSave: ((result: SaveDocumentResult) => void) | undefined
    vi.mocked(api.saveDocument).mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve
      }),
    )

    const saving = controller.handleCommand({ type: 'save' })
    await vi.waitFor(() => expect(api.saveDocument).toHaveBeenCalledOnce())

    editorMarkdown = 'edited while saving'
    finishSave?.({ canceled: false, filePath: 'C:\\notes\\draft.md' })
    await saving

    expect(useAppStore.getState().document).toMatchObject({
      markdown: 'edited while saving',
      savedMarkdown: 'unsaved content',
      filePath: 'C:\\notes\\draft.md',
      dirty: true,
    })
  })

  it('returns undefined when saving an untitled document for an image is canceled', async () => {
    editorMarkdown = 'untitled content'
    useAppStore.getState().setDocument(editorMarkdown)
    vi.mocked(api.saveDocument).mockResolvedValue({ canceled: true })

    await expect(controller.ensureDocumentSaved()).resolves.toBeUndefined()

    expect(api.saveDocument).toHaveBeenCalledWith({
      filePath: undefined,
      content: 'untitled content',
      saveAs: false,
    })
    expect(useAppStore.getState().document.filePath).toBeUndefined()
  })

  it('queues concurrent image save requests and returns the saved document path', async () => {
    editorMarkdown = 'untitled content'
    useAppStore.getState().setDocument(editorMarkdown)
    vi.mocked(api.saveDocument).mockResolvedValue({
      canceled: false,
      filePath: 'C:\\notes\\saved.md',
    })

    await expect(
      Promise.all([controller.ensureDocumentSaved(), controller.ensureDocumentSaved()]),
    ).resolves.toEqual(['C:\\notes\\saved.md', 'C:\\notes\\saved.md'])
    expect(api.saveDocument).toHaveBeenCalledOnce()
  })

  it('serializes a mode switch before saving the latest source snapshot', async () => {
    let finishSwitch: (() => void) | undefined
    vi.mocked(editor.toggleMode).mockReturnValue(
      new Promise((resolve) => {
        finishSwitch = resolve
      }),
    )
    vi.mocked(editor.getMode).mockReturnValue('source')
    vi.mocked(api.saveDocument).mockResolvedValue({
      canceled: false,
      filePath: 'C:\\notes\\draft.md',
    })

    const switching = controller.handleCommand({ type: 'toggle-editor-mode' })
    editorMarkdown = '# 源码最新内容\n\n中文与 ![图片](a.png)'
    const saving = controller.handleCommand({ type: 'save' })
    await Promise.resolve()

    expect(api.saveDocument).not.toHaveBeenCalled()
    finishSwitch?.()
    await switching
    await saving

    expect(api.saveDocument).toHaveBeenCalledWith({
      filePath: 'C:\\notes\\draft.md',
      content: '# 源码最新内容\n\n中文与 ![图片](a.png)',
      saveAs: false,
    })
  })
})
