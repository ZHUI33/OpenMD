import { join } from 'node:path'

import type { BrowserWindow } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
}))

import { DocumentService } from '../src/main/document-service'
import type { RecentFilesStore } from '../src/main/recent-files'

function createWindow(id = 17): BrowserWindow {
  return {
    webContents: {
      id,
      isDestroyed: () => false,
      send: vi.fn(),
    },
    isDestroyed: () => false,
    once: vi.fn(),
  } as unknown as BrowserWindow
}

function createRecentFilesStore(): RecentFilesStore {
  return {
    whenIdle: vi.fn(() => Promise.resolve()),
    hasFile: vi.fn(() => Promise.resolve(false)),
    addFile: vi.fn(() => Promise.resolve([])),
    removeFile: vi.fn(() => Promise.resolve([])),
  } as unknown as RecentFilesStore
}

describe('DocumentService multi-document authorization', () => {
  it('keeps independent open tab paths authorized when a new tab is created', () => {
    const service = new DocumentService(createRecentFilesStore(), vi.fn())
    const parentWindow = createWindow()
    const firstPath = join('D:\\workspace', 'first.md')
    const secondPath = join('D:\\workspace', 'second.md')

    service.authorizeDocumentPath(parentWindow, firstPath)
    service.authorizeDocumentPath(parentWindow, secondPath)
    service.newDocument(parentWindow)

    expect(service.getAuthorizedDocumentPath(parentWindow, firstPath)).toBe(firstPath)
    expect(service.getAuthorizedDocumentPath(parentWindow, secondPath)).toBe(secondPath)
    expect(service.isPathAuthorized(parentWindow, firstPath)).toBe(true)
    expect(service.isPathAuthorized(parentWindow, join('D:\\workspace', 'other.md'))).toBe(false)
  })

  it('remaps and revokes every authorized document below renamed or deleted entries', () => {
    const service = new DocumentService(createRecentFilesStore(), vi.fn())
    const parentWindow = createWindow()
    const oldDirectory = join('D:\\workspace', 'drafts')
    const newDirectory = join('D:\\workspace', 'published')
    const firstPath = join(oldDirectory, 'one.md')
    const secondPath = join(oldDirectory, 'nested', 'two.md')

    service.authorizeDocumentPath(parentWindow, firstPath)
    service.authorizeDocumentPath(parentWindow, secondPath)
    service.handleWorkspaceEntryRenamed(parentWindow, oldDirectory, newDirectory)

    const renamedFirst = join(newDirectory, 'one.md')
    const renamedSecond = join(newDirectory, 'nested', 'two.md')
    expect(service.isPathAuthorized(parentWindow, firstPath)).toBe(false)
    expect(service.isPathAuthorized(parentWindow, renamedFirst)).toBe(true)
    expect(service.isPathAuthorized(parentWindow, renamedSecond)).toBe(true)

    service.handleWorkspaceEntryDeleted(parentWindow, newDirectory)
    expect(service.isPathAuthorized(parentWindow, renamedFirst)).toBe(false)
    expect(service.isPathAuthorized(parentWindow, renamedSecond)).toBe(false)
  })

  it('releases a closed tab path and its watcher without revoking other tabs', () => {
    const watcher = {
      watchFile: vi.fn(),
      unwatchFile: vi.fn(),
      unwatchRecipient: vi.fn(),
      markSelfSave: vi.fn(),
      clearSelfSave: vi.fn(),
    }
    const service = new DocumentService(createRecentFilesStore(), vi.fn(), { watcher })
    const parentWindow = createWindow()
    const firstPath = join('D:\\workspace', 'first.md')
    const secondPath = join('D:\\workspace', 'second.md')
    service.authorizeDocumentPath(parentWindow, firstPath)
    service.authorizeDocumentPath(parentWindow, secondPath)

    service.releaseDocumentPath(parentWindow, firstPath)

    expect(service.isPathAuthorized(parentWindow, firstPath)).toBe(false)
    expect(service.isPathAuthorized(parentWindow, secondPath)).toBe(true)
    expect(watcher.unwatchFile).toHaveBeenCalledWith(parentWindow.webContents.id, firstPath)
  })

  it('refuses a save target that belongs to another open tab before writing', async () => {
    const service = new DocumentService(createRecentFilesStore(), vi.fn())
    const parentWindow = createWindow()
    const targetPath = join('D:\\workspace', 'already-open.md')
    service.authorizeDocumentPath(parentWindow, targetPath)

    await expect(
      service.saveDocument(parentWindow, {
        filePath: targetPath,
        content: 'must not be written',
        forbiddenFilePaths: [targetPath],
      }),
    ).resolves.toEqual({ canceled: false, error: true })
  })
})
