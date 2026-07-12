import { ipcRenderer } from 'electron'

import type {
  AppInfo,
  ConfirmCloseRequest,
  ConfirmCloseResult,
  DocumentCommand,
  NewDocumentResult,
  OpenDocumentRequest,
  OpenDocumentResult,
  OpenMdApi,
  ResolveCloseRequest,
  SaveDocumentRequest,
  SaveDocumentResult,
} from '../shared/desktop-api.types'
import { IPC_CHANNELS } from '../shared/ipc-channels'

export const openMdApi: OpenMdApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo) as Promise<AppInfo>,
  documents: Object.freeze({
    ready: () => ipcRenderer.invoke(IPC_CHANNELS.documentsReady) as Promise<void>,
    newDocument: () => ipcRenderer.invoke(IPC_CHANNELS.documentsNew) as Promise<NewDocumentResult>,
    openDocument: (request: OpenDocumentRequest = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.documentsOpen, request) as Promise<OpenDocumentResult>,
    saveDocument: (request: SaveDocumentRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.documentsSave, request) as Promise<SaveDocumentResult>,
    confirmClose: (request: ConfirmCloseRequest) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.documentsConfirmClose,
        request,
      ) as Promise<ConfirmCloseResult>,
    reload: () => ipcRenderer.invoke(IPC_CHANNELS.documentsReload) as Promise<void>,
    resolveClose: (request: ResolveCloseRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.documentsResolveClose, request) as Promise<void>,
    onCommand: (listener: (command: DocumentCommand) => void) => {
      const ipcListener = (_event: Electron.IpcRendererEvent, command: DocumentCommand): void => {
        listener(command)
      }

      ipcRenderer.on(IPC_CHANNELS.documentsCommand, ipcListener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.documentsCommand, ipcListener)
      }
    },
  }),
})
