import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'
import type { Event } from 'electron'

import type { CloseIntent, DocumentCommand, ResolveCloseRequest } from '../shared/desktop-api.types'
import { IPC_CHANNELS } from '../shared/ipc-channels'

let mainWindow: BrowserWindow | null = null
let closeApproved = false
let applicationQuitApproved = false
let pendingClose:
  | { commandIntent: CloseIntent; completionIntent: CloseIntent; requestId: string }
  | undefined
let nextCloseRequestId = 0
let rendererReady = false
let queuedCommands: DocumentCommand[] = []

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function sendDocumentCommand(command: DocumentCommand): void {
  const window = getMainWindow() ?? createMainWindow()
  if (window.webContents.isDestroyed()) return
  if (!rendererReady) {
    queuedCommands.push(command)
    return
  }
  window.webContents.send(IPC_CHANNELS.documentsCommand, command)
}

export function markRendererReady(senderWindow: BrowserWindow): void {
  if (senderWindow !== getMainWindow())
    throw new Error('Rejected renderer-ready from another window.')

  rendererReady = true
  const commands = queuedCommands
  queuedCommands = []
  for (const command of commands) {
    senderWindow.webContents.send(IPC_CHANNELS.documentsCommand, command)
  }
}

export function reloadMainWindow(senderWindow: BrowserWindow, filePath?: string): void {
  if (senderWindow !== getMainWindow()) throw new Error('Rejected reload from another window.')

  rendererReady = false
  queuedCommands = filePath ? [{ type: 'open-recent', filePath }] : []
  setTimeout(() => {
    if (senderWindow === getMainWindow() && !senderWindow.webContents.isDestroyed()) {
      senderWindow.webContents.reload()
    }
  }, 0)
}

function requestRendererClose(intent: CloseIntent): void {
  const window = getMainWindow()
  if (!window) {
    if (intent === 'application') {
      applicationQuitApproved = true
      queueMicrotask(() => app.quit())
    }
    return
  }
  if (pendingClose) {
    if (intent === 'application') pendingClose.completionIntent = 'application'
    return
  }

  const requestId = String(++nextCloseRequestId)
  pendingClose = { commandIntent: intent, completionIntent: intent, requestId }
  sendDocumentCommand({ type: 'close', intent, requestId })
}

export function handleBeforeQuit(event: Event): void {
  if (applicationQuitApproved) return

  if (!getMainWindow() || !rendererReady) {
    applicationQuitApproved = true
    return
  }

  event.preventDefault()
  requestRendererClose('application')
}

export function resolveCloseRequest(
  senderWindow: BrowserWindow,
  request: ResolveCloseRequest,
): void {
  if (
    senderWindow !== getMainWindow() ||
    !pendingClose ||
    pendingClose.commandIntent !== request.intent ||
    pendingClose.requestId !== request.requestId
  ) {
    throw new Error('Rejected a stale close response.')
  }

  const completionIntent = pendingClose.completionIntent
  pendingClose = undefined
  if (!request.proceed) return

  closeApproved = true
  if (completionIntent === 'application') {
    applicationQuitApproved = true
    app.quit()
  } else {
    senderWindow.close()
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  closeApproved = false
  pendingClose = undefined
  rendererReady = false
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'OpenMD',
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false
  })
  mainWindow.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) rendererReady = false
  })
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false
  })
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.on('close', (event) => {
    if (closeApproved || applicationQuitApproved || !rendererReady) return

    event.preventDefault()
    requestRendererClose('window')
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    closeApproved = false
    pendingClose = undefined
    rendererReady = false
    queuedCommands = []
  })

  return mainWindow
}
