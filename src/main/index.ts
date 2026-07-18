import { extname, join, resolve } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { DocumentService } from './document-service'
import { ImageService } from './image-service'
import { ExportService } from './export-service'
import { getTrustedSenderWindow, registerIpcHandlers } from './ipc'
import { registerSettingsIpcHandlers } from './ipc/settings'
import { installApplicationMenu } from './menu'
import { OpenedFileWatcher } from './opened-file-watcher'
import { RecentFilesStore } from './recent-files'
import { SettingsService } from './settings-service'
import { UserThemeService } from './user-theme-service'
import { UpdateService } from './update-service'
import { createMainWindow, handleBeforeQuit, sendDocumentCommand } from './window'
import { WorkspaceService } from './workspace-service'

function markdownPathFromArguments(argumentsList: readonly string[]): string | undefined {
  const value = argumentsList.find((argument) => {
    const extension = extname(argument).toLocaleLowerCase('en-US')
    return extension === '.md' || extension === '.markdown'
  })
  return value ? resolve(value) : undefined
}

if (process.env.OPENMD_E2E_USER_DATA) {
  app.setPath('userData', resolve(process.env.OPENMD_E2E_USER_DATA))
}
app.setAppUserModelId('io.openmd.app')

let fileToOpen = markdownPathFromArguments(process.argv)
let openExternalDocument = (filePath: string): void => {
  fileToOpen = filePath
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argumentsList) => {
  const requestedPath = markdownPathFromArguments(argumentsList)
  if (requestedPath) openExternalDocument(requestedPath)
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  openExternalDocument(filePath)
})

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
  const exportService = new ExportService()
  const updateService = new UpdateService()

  registerIpcHandlers(documentService, imageService, workspaceService, exportService)
  registerSettingsIpcHandlers(settingsService, userThemeService, getTrustedSenderWindow)
  const mainWindow = createMainWindow()
  openExternalDocument = (filePath): void => {
    const targetWindow = createMainWindow()
    documentService.authorizeDocumentPath(targetWindow, filePath)
    sendDocumentCommand({ type: 'open-recent', filePath })
  }
  if (fileToOpen) {
    documentService.authorizeDocumentPath(mainWindow, fileToOpen)
    sendDocumentCommand({ type: 'open-recent', filePath: fileToOpen })
    fileToOpen = undefined
  }
  void settingsService
    .getSettings()
    .then((settings) => updateService.start(settings.autoUpdate))
    .catch(() => undefined)
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
