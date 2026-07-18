import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type {
  AppInfo,
  ConfirmCloseRequest,
  ExportHtmlRequest,
  ExportPdfRequest,
  OpenDocumentRequest,
  ResolveImageRequest,
  ResolveCloseRequest,
  SaveDocumentRequest,
  SaveImageRequest,
  SelectImageRequest,
  CreateWorkspaceEntryRequest,
  ListWorkspaceDirectoryRequest,
  RenameWorkspaceEntryRequest,
  ReleaseDocumentRequest,
  WorkspacePathRequest,
  WorkspaceSearchRequest,
} from '../../shared/desktop-api.types'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { DocumentService } from '../document-service'
import type { ExportService } from '../export-service'
import type { ImageService } from '../image-service'
import type { WorkspaceService } from '../workspace-service'
import { markRendererReady, reloadMainWindow, resolveCloseRequest } from '../window'

function isTrustedRendererUrl(frameUrl: string): boolean {
  try {
    const actualUrl = new URL(frameUrl)
    if (process.env.ELECTRON_RENDERER_URL) {
      return actualUrl.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    }

    const expectedUrl = pathToFileURL(join(__dirname, '../renderer/index.html'))
    actualUrl.hash = ''
    actualUrl.search = ''
    return actualUrl.href === expectedUrl.href
  } catch {
    return false
  }
}

export function getTrustedSenderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)

  if (
    !senderWindow ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error('Blocked IPC request from an untrusted renderer.')
  }

  return senderWindow
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseOpenRequest(value: unknown): OpenDocumentRequest {
  if (!isRecord(value) || (value.filePath !== undefined && typeof value.filePath !== 'string')) {
    throw new TypeError('Invalid open document request.')
  }
  return { filePath: value.filePath as string | undefined }
}

function parseForbiddenFilePaths(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length > 1_000 ||
    value.some(
      (filePath) =>
        typeof filePath !== 'string' ||
        filePath.length === 0 ||
        filePath.length > 32_768 ||
        filePath.includes('\0'),
    )
  ) {
    throw new TypeError('Invalid forbidden document paths.')
  }
  return [...value]
}

function parseSaveRequest(value: unknown): SaveDocumentRequest {
  if (
    !isRecord(value) ||
    typeof value.content !== 'string' ||
    (value.filePath !== undefined && typeof value.filePath !== 'string') ||
    (value.saveAs !== undefined && typeof value.saveAs !== 'boolean')
  ) {
    throw new TypeError('Invalid save document request.')
  }
  return {
    content: value.content,
    filePath: value.filePath as string | undefined,
    saveAs: value.saveAs as boolean | undefined,
    forbiddenFilePaths: parseForbiddenFilePaths(value.forbiddenFilePaths),
  }
}

function parseConfirmCloseRequest(value: unknown): ConfirmCloseRequest {
  if (
    !isRecord(value) ||
    typeof value.content !== 'string' ||
    (value.filePath !== undefined && typeof value.filePath !== 'string')
  ) {
    throw new TypeError('Invalid confirm close request.')
  }
  return {
    content: value.content,
    filePath: value.filePath as string | undefined,
    forbiddenFilePaths: parseForbiddenFilePaths(value.forbiddenFilePaths),
  }
}

function parseReleaseDocumentRequest(value: unknown): ReleaseDocumentRequest {
  if (
    !isRecord(value) ||
    typeof value.filePath !== 'string' ||
    !value.filePath ||
    value.filePath.length > 32_768 ||
    value.filePath.includes('\0')
  ) {
    throw new TypeError('Invalid release document request.')
  }
  return { filePath: value.filePath }
}

function parseResolveCloseRequest(value: unknown): ResolveCloseRequest {
  if (
    !isRecord(value) ||
    (value.intent !== 'window' && value.intent !== 'application') ||
    typeof value.requestId !== 'string' ||
    typeof value.proceed !== 'boolean'
  ) {
    throw new TypeError('Invalid resolve close request.')
  }
  return { intent: value.intent, requestId: value.requestId, proceed: value.proceed }
}

function parseSaveImageRequest(value: unknown): SaveImageRequest {
  if (
    !isRecord(value) ||
    typeof value.documentPath !== 'string' ||
    !(value.bytes instanceof Uint8Array) ||
    (value.suggestedName !== undefined && typeof value.suggestedName !== 'string')
  ) {
    throw new TypeError('Invalid save image request.')
  }
  return {
    documentPath: value.documentPath,
    bytes: value.bytes,
    suggestedName: value.suggestedName as string | undefined,
  }
}

function parseSelectImageRequest(value: unknown): SelectImageRequest {
  if (!isRecord(value) || typeof value.documentPath !== 'string') {
    throw new TypeError('Invalid select image request.')
  }
  return { documentPath: value.documentPath }
}

function parseResolveImageRequest(value: unknown): ResolveImageRequest {
  if (
    !isRecord(value) ||
    typeof value.documentPath !== 'string' ||
    typeof value.source !== 'string'
  ) {
    throw new TypeError('Invalid resolve image request.')
  }
  return { documentPath: value.documentPath, source: value.source }
}

function parseExportHtmlRequest(value: unknown): ExportHtmlRequest {
  if (
    !isRecord(value) ||
    typeof value.documentHtml !== 'string' ||
    typeof value.title !== 'string' ||
    value.title.length > 1_000 ||
    (value.documentPath !== undefined && typeof value.documentPath !== 'string')
  ) {
    throw new TypeError('Invalid HTML export request.')
  }
  return {
    documentHtml: value.documentHtml,
    title: value.title,
    documentPath: value.documentPath as string | undefined,
  }
}

function parseExportPdfRequest(value: unknown): ExportPdfRequest {
  const html = parseExportHtmlRequest(value)
  if (
    !isRecord(value) ||
    (value.pageSize !== 'A4' && value.pageSize !== 'Letter') ||
    typeof value.printBackground !== 'boolean' ||
    !isRecord(value.margins)
  ) {
    throw new TypeError('Invalid PDF export request.')
  }
  const margins = {} as ExportPdfRequest['margins']
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const margin = value.margins[side]
    if (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0 || margin > 5) {
      throw new TypeError(`Invalid PDF ${side} margin.`)
    }
    margins[side] = margin
  }
  return {
    ...html,
    pageSize: value.pageSize,
    printBackground: value.printBackground,
    margins,
  }
}

function parseRelativePath(value: unknown, fieldName = 'relativePath'): string {
  if (typeof value !== 'string' || value.length > 32_768 || value.includes('\0')) {
    throw new TypeError(`Invalid workspace ${fieldName}.`)
  }
  return value
}

function parseWorkspacePathRequest(value: unknown): WorkspacePathRequest {
  if (!isRecord(value)) throw new TypeError('Invalid workspace path request.')
  return { relativePath: parseRelativePath(value.relativePath) }
}

function parseListWorkspaceDirectoryRequest(value: unknown): ListWorkspaceDirectoryRequest {
  if (
    !isRecord(value) ||
    (value.includeTextFiles !== undefined && typeof value.includeTextFiles !== 'boolean')
  ) {
    throw new TypeError('Invalid list workspace directory request.')
  }
  return {
    relativePath:
      value.relativePath === undefined ? undefined : parseRelativePath(value.relativePath),
    includeTextFiles: value.includeTextFiles as boolean | undefined,
  }
}

function parseCreateWorkspaceEntryRequest(value: unknown): CreateWorkspaceEntryRequest {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.length > 255) {
    throw new TypeError('Invalid create workspace entry request.')
  }
  return {
    parentRelativePath:
      value.parentRelativePath === undefined
        ? undefined
        : parseRelativePath(value.parentRelativePath, 'parentRelativePath'),
    name: value.name,
  }
}

function parseRenameWorkspaceEntryRequest(value: unknown): RenameWorkspaceEntryRequest {
  if (!isRecord(value) || typeof value.newName !== 'string' || value.newName.length > 255) {
    throw new TypeError('Invalid rename workspace entry request.')
  }
  return {
    relativePath: parseRelativePath(value.relativePath),
    newName: value.newName,
  }
}

function parseWorkspaceSearchRequest(value: unknown): WorkspaceSearchRequest {
  if (
    !isRecord(value) ||
    typeof value.query !== 'string' ||
    value.query.length > 1_000 ||
    (value.caseSensitive !== undefined && typeof value.caseSensitive !== 'boolean') ||
    (value.includeTextFiles !== undefined && typeof value.includeTextFiles !== 'boolean') ||
    (value.maxResults !== undefined &&
      (typeof value.maxResults !== 'number' ||
        !Number.isInteger(value.maxResults) ||
        value.maxResults <= 0))
  ) {
    throw new TypeError('Invalid workspace search request.')
  }
  return {
    query: value.query,
    caseSensitive: value.caseSensitive as boolean | undefined,
    includeTextFiles: value.includeTextFiles as boolean | undefined,
    maxResults: value.maxResults as number | undefined,
  }
}

export function registerIpcHandlers(
  documentService: DocumentService,
  imageService: ImageService,
  workspaceService: WorkspaceService,
  exportService: ExportService,
): void {
  ipcMain.removeHandler(IPC_CHANNELS.appGetInfo)
  ipcMain.handle(IPC_CHANNELS.appGetInfo, (event): AppInfo => {
    getTrustedSenderWindow(event)

    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    }
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsNew)
  ipcMain.handle(IPC_CHANNELS.documentsNew, (event) => {
    return documentService.newDocument(getTrustedSenderWindow(event))
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsReady)
  ipcMain.handle(IPC_CHANNELS.documentsReady, (event) => {
    markRendererReady(getTrustedSenderWindow(event))
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsOpen)
  ipcMain.handle(IPC_CHANNELS.documentsOpen, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    return documentService.openDocument(senderWindow, parseOpenRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsSave)
  ipcMain.handle(IPC_CHANNELS.documentsSave, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    return documentService.saveDocument(senderWindow, parseSaveRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsConfirmClose)
  ipcMain.handle(IPC_CHANNELS.documentsConfirmClose, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    return documentService.confirmClose(senderWindow, parseConfirmCloseRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsRelease)
  ipcMain.handle(IPC_CHANNELS.documentsRelease, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    const request = parseReleaseDocumentRequest(value)
    documentService.releaseDocumentPath(senderWindow, request.filePath)
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsResolveClose)
  ipcMain.handle(IPC_CHANNELS.documentsResolveClose, async (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    const request = parseResolveCloseRequest(value)
    await documentService.flushRecentFiles()
    resolveCloseRequest(senderWindow, request)
  })

  ipcMain.removeHandler(IPC_CHANNELS.documentsReload)
  ipcMain.handle(IPC_CHANNELS.documentsReload, (event) => {
    const senderWindow = getTrustedSenderWindow(event)
    reloadMainWindow(senderWindow, documentService.getCurrentPath(senderWindow))
  })

  ipcMain.removeHandler(IPC_CHANNELS.imagesSave)
  ipcMain.handle(IPC_CHANNELS.imagesSave, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    return imageService.saveImage(senderWindow, parseSaveImageRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.imagesSelect)
  ipcMain.handle(IPC_CHANNELS.imagesSelect, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    return imageService.selectImage(senderWindow, parseSelectImageRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.imagesResolve)
  ipcMain.handle(IPC_CHANNELS.imagesResolve, (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    return imageService.resolveImage(senderWindow, parseResolveImageRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.exportHtml)
  ipcMain.handle(IPC_CHANNELS.exportHtml, (event, value: unknown) => {
    return exportService.exportHtml(getTrustedSenderWindow(event), parseExportHtmlRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.exportPdf)
  ipcMain.handle(IPC_CHANNELS.exportPdf, (event, value: unknown) => {
    return exportService.exportPdf(getTrustedSenderWindow(event), parseExportPdfRequest(value))
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceOpen)
  ipcMain.handle(IPC_CHANNELS.workspaceOpen, (event) => {
    return workspaceService.open(getTrustedSenderWindow(event))
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceGetCurrent)
  ipcMain.handle(IPC_CHANNELS.workspaceGetCurrent, (event) => {
    return workspaceService.getCurrent(getTrustedSenderWindow(event))
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceListDirectory)
  ipcMain.handle(IPC_CHANNELS.workspaceListDirectory, (event, value: unknown) => {
    return workspaceService.listDirectory(
      getTrustedSenderWindow(event),
      parseListWorkspaceDirectoryRequest(value),
    )
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceReadFile)
  ipcMain.handle(IPC_CHANNELS.workspaceReadFile, async (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    const result = await workspaceService.readFile(senderWindow, parseWorkspacePathRequest(value))
    documentService.authorizeDocumentPath(senderWindow, result.filePath, result.relativePath)
    return result
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceCreateMarkdownFile)
  ipcMain.handle(IPC_CHANNELS.workspaceCreateMarkdownFile, async (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    const entry = await workspaceService.createMarkdownFile(
      senderWindow,
      parseCreateWorkspaceEntryRequest(value),
    )
    documentService.authorizeDocumentPath(senderWindow, entry.filePath, entry.relativePath)
    return entry
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceCreateDirectory)
  ipcMain.handle(IPC_CHANNELS.workspaceCreateDirectory, (event, value: unknown) => {
    return workspaceService.createDirectory(
      getTrustedSenderWindow(event),
      parseCreateWorkspaceEntryRequest(value),
    )
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceRenameEntry)
  ipcMain.handle(IPC_CHANNELS.workspaceRenameEntry, async (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    const request = parseRenameWorkspaceEntryRequest(value)
    const previousPath = await workspaceService.resolveEntryPath(senderWindow, request)
    const entry = await workspaceService.renameEntry(senderWindow, request)
    documentService.handleWorkspaceEntryRenamed(senderWindow, previousPath, entry.filePath)
    return entry
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceDeleteEntry)
  ipcMain.handle(IPC_CHANNELS.workspaceDeleteEntry, async (event, value: unknown) => {
    const senderWindow = getTrustedSenderWindow(event)
    const request = parseWorkspacePathRequest(value)
    const deletedPath = await workspaceService.resolveEntryPath(senderWindow, request)
    const result = await workspaceService.deleteEntry(senderWindow, request)
    if (result.deleted) documentService.handleWorkspaceEntryDeleted(senderWindow, deletedPath)
    return result
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceRevealEntry)
  ipcMain.handle(IPC_CHANNELS.workspaceRevealEntry, (event, value: unknown) => {
    return workspaceService.revealEntry(
      getTrustedSenderWindow(event),
      parseWorkspacePathRequest(value),
    )
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceCopyRelativePath)
  ipcMain.handle(IPC_CHANNELS.workspaceCopyRelativePath, (event, value: unknown) => {
    return workspaceService.copyRelativePath(
      getTrustedSenderWindow(event),
      parseWorkspacePathRequest(value),
    )
  })

  ipcMain.removeHandler(IPC_CHANNELS.workspaceSearch)
  ipcMain.handle(IPC_CHANNELS.workspaceSearch, (event, value: unknown) => {
    return workspaceService.search(
      getTrustedSenderWindow(event),
      parseWorkspaceSearchRequest(value),
    )
  })
}
