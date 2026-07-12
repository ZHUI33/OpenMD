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
    reload: vi.fn(() => Promise.resolve()),
    resolveClose: vi.fn(() => Promise.resolve()),
    onCommand: vi.fn(() => () => undefined),
  }
}

function setDocument(markdown: string, filePath: string, dirtyMarkdown?: string): void {
  useAppStore.setState({
    theme: 'system',
    sidebarVisible: false,
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
})
