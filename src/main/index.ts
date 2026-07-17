import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { DocumentService } from './document-service'
import { ImageService } from './image-service'
import { getTrustedSenderWindow, registerIpcHandlers } from './ipc'
import { registerSettingsIpcHandlers } from './ipc/settings'
import { installApplicationMenu } from './menu'
import { OpenedFileWatcher } from './opened-file-watcher'
import { RecentFilesStore } from './recent-files'
import { SettingsService } from './settings-service'
import { UserThemeService } from './user-theme-service'
import { createMainWindow, handleBeforeQuit, sendDocumentCommand } from './window'
import { WorkspaceService } from './workspace-service'

app.on('before-quit', handleBeforeQuit)

void app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  const recentFilesStore = new RecentFilesStore(join(userDataPath, 'recent-files.json'))
  const updateMenu = (
    recentFiles: Awaited<ReturnType<RecentFilesStore['getRecentFiles']>>,
  ): void => {
    installApplicationMenu(recentFiles, sendDocumentCommand)
  }
  const workspaceService = new WorkspaceService()
  const openedFileWatcher = new OpenedFileWatcher()
  const settingsService = new SettingsService(join(userDataPath, 'settings.json'))
  const userThemeService = new UserThemeService(join(userDataPath, 'themes'))
  const documentService = new DocumentService(recentFilesStore, updateMenu, {
    canOpenPath: (parentWindow, filePath) =>
      workspaceService.isDocumentPathAllowed(parentWindow, filePath),
    getWorkspaceRelativePath: (parentWindow, filePath) =>
      workspaceService.getRelativePath(parentWindow, filePath),
    watcher: openedFileWatcher,
  })
  const imageService = new ImageService(
    documentService,
    () => new Date(),
    async (parentWindow) => {
      const settings = await settingsService.getSettings()
      return {
        rule: settings.imageAssetDirectoryRule,
        customDirectory: settings.customImageAssetDirectory,
        workspaceRoot: workspaceService.getCurrent(parentWindow)?.rootPath,
      }
    },
  )

  registerIpcHandlers(documentService, imageService, workspaceService)
  registerSettingsIpcHandlers(settingsService, userThemeService, getTrustedSenderWindow)
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
