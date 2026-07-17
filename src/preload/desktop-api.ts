import { ipcRenderer } from 'electron'

import type {
  AppInfo,
  ConfirmCloseRequest,
  ConfirmCloseResult,
  RendererCommand,
  ReleaseDocumentRequest,
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
  CreateWorkspaceEntryRequest,
  DeleteWorkspaceEntryResult,
  ListWorkspaceDirectoryRequest,
  OpenWorkspaceResult,
  RenameWorkspaceEntryRequest,
  WorkspaceEntry,
  WorkspaceFileChange,
  WorkspaceFileResult,
  WorkspaceInfo,
  WorkspacePathRequest,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '../shared/desktop-api.types'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { AppSettings, AppSettingsUpdate } from '../shared/settings'
import type { LoadedUserTheme, UserThemeInfo } from '../shared/theme'

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
    releaseDocument: (request: ReleaseDocumentRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.documentsRelease, request) as Promise<void>,
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
  workspace: Object.freeze({
    open: () => ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen) as Promise<OpenWorkspaceResult>,
    getCurrent: () =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceGetCurrent) as Promise<WorkspaceInfo | undefined>,
    listDirectory: (request: ListWorkspaceDirectoryRequest = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceListDirectory, request) as Promise<WorkspaceEntry[]>,
    readFile: (request: WorkspacePathRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, request) as Promise<WorkspaceFileResult>,
    createMarkdownFile: (request: CreateWorkspaceEntryRequest) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.workspaceCreateMarkdownFile,
        request,
      ) as Promise<WorkspaceEntry>,
    createDirectory: (request: CreateWorkspaceEntryRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceCreateDirectory, request) as Promise<WorkspaceEntry>,
    renameEntry: (request: RenameWorkspaceEntryRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceRenameEntry, request) as Promise<WorkspaceEntry>,
    deleteEntry: (request: WorkspacePathRequest) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.workspaceDeleteEntry,
        request,
      ) as Promise<DeleteWorkspaceEntryResult>,
    revealEntry: (request: WorkspacePathRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceRevealEntry, request) as Promise<void>,
    copyRelativePath: (request: WorkspacePathRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceCopyRelativePath, request) as Promise<void>,
    search: (request: WorkspaceSearchRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.workspaceSearch, request) as Promise<WorkspaceSearchResult>,
    onFileChange: (listener: (change: WorkspaceFileChange) => void) => {
      const ipcListener = (
        _event: Electron.IpcRendererEvent,
        change: WorkspaceFileChange,
      ): void => {
        listener(change)
      }
      ipcRenderer.on(IPC_CHANNELS.workspaceFileChanged, ipcListener)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.workspaceFileChanged, ipcListener)
      }
    },
  }),
  settings: Object.freeze({
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet) as Promise<AppSettings>,
    update: (update: AppSettingsUpdate) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, update) as Promise<AppSettings>,
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.settingsReset) as Promise<AppSettings>,
    listUserThemes: () => ipcRenderer.invoke(IPC_CHANNELS.themesList) as Promise<UserThemeInfo[]>,
    loadUserTheme: (themeId: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.themesLoad, themeId) as Promise<LoadedUserTheme>,
  }),
})
