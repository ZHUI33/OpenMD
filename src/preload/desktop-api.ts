import { ipcRenderer } from 'electron'

import type {
  AppInfo,
  ConfirmCloseRequest,
  ConfirmCloseResult,
  RendererCommand,
  ResolveImageRequest,
  ResolveImageResult,
  NewDocumentResult,
  OpenDocumentRequest,
  OpenDocumentResult,
  OpenMdApi,
  ResolveCloseRequest,
  SaveDocumentRequest,
  SaveDocumentResult,
  SaveImageRequest,
  SaveImageResult,
  SelectImageRequest,
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
    onCommand: (listener: (command: RendererCommand) => void) => {
      const ipcListener = (_event: Electron.IpcRendererEvent, command: RendererCommand): void => {
        listener(command)
      }

      ipcRenderer.on(IPC_CHANNELS.documentsCommand, ipcListener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.documentsCommand, ipcListener)
      }
    },
  }),
  images: Object.freeze({
    saveImage: (request: SaveImageRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.imagesSave, request) as Promise<SaveImageResult>,
    selectImage: (request: SelectImageRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.imagesSelect, request) as Promise<SaveImageResult>,
    resolveImage: (request: ResolveImageRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.imagesResolve, request) as Promise<ResolveImageResult>,
  }),
})
