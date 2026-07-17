import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type {
  AppInfo,
  ConfirmCloseRequest,
  OpenDocumentRequest,
  ResolveImageRequest,
  ResolveCloseRequest,
  SaveDocumentRequest,
  SaveImageRequest,
  SelectImageRequest,
} from '../../shared/desktop-api.types'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import type { DocumentService } from '../document-service'
import type { ImageService } from '../image-service'
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

function getTrustedSenderWindow(event: IpcMainInvokeEvent): BrowserWindow {
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
  return { content: value.content, filePath: value.filePath as string | undefined }
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

export function registerIpcHandlers(
  documentService: DocumentService,
  imageService: ImageService,
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
}
