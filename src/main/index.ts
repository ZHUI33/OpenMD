import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { DocumentService } from './document-service'
import { ImageService } from './image-service'
import { registerIpcHandlers } from './ipc'
import { installApplicationMenu } from './menu'
import { RecentFilesStore } from './recent-files'
import { createMainWindow, handleBeforeQuit, sendDocumentCommand } from './window'

app.on('before-quit', handleBeforeQuit)

void app.whenReady().then(() => {
  const recentFilesStore = new RecentFilesStore(join(app.getPath('userData'), 'recent-files.json'))
  const updateMenu = (
    recentFiles: Awaited<ReturnType<RecentFilesStore['getRecentFiles']>>,
  ): void => {
    installApplicationMenu(recentFiles, sendDocumentCommand)
  }
  const documentService = new DocumentService(recentFilesStore, updateMenu)
  const imageService = new ImageService(documentService)

  registerIpcHandlers(documentService, imageService)
  createMainWindow()
  updateMenu([])
  void recentFilesStore
    .getRecentFiles()
    .then(updateMenu)
    .catch((error: unknown) => {
      if (!app.isPackaged) console.error('Failed to initialize recent files:', error)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
