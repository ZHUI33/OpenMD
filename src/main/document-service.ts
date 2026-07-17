import { isAbsolute, relative, resolve, sep } from 'node:path'

import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'

import type {
  ConfirmCloseRequest,
  ConfirmCloseResult,
  OpenDocumentRequest,
  OpenDocumentResult,
  RecentFile,
  SaveDocumentRequest,
  SaveDocumentResult,
} from '../shared/desktop-api.types'
import { getFileNameFromPath } from '../shared/document-utils'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { readUtf8Document, withDefaultMarkdownExtension, writeUtf8Document } from './document-files'
import type { FileWatchRecipient, OpenedFileWatcher } from './opened-file-watcher'
import { areSameFilePaths } from './recent-files'
import type { RecentFilesStore } from './recent-files'

const DOCUMENT_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: '文本文件', extensions: ['txt'] },
]
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

function isSupportedDocumentPath(filePath: string): boolean {
  const normalized = filePath.toLocaleLowerCase('en-US')
  return [...SUPPORTED_EXTENSIONS].some((extension) => normalized.endsWith(extension))
}

export interface DocumentServiceOptions {
  canOpenPath?: (parentWindow: BrowserWindow, filePath: string) => boolean | Promise<boolean>
  getWorkspaceRelativePath?: (parentWindow: BrowserWindow, filePath: string) => string | undefined
  watcher?: Pick<
    OpenedFileWatcher,
    'watchFile' | 'unwatchFile' | 'unwatchRecipient' | 'markSelfSave' | 'clearSelfSave'
  >
}

export class DocumentService {
  private readonly currentPaths = new Map<number, string>()
  private readonly authorizedPaths = new Map<number, string[]>()
  private readonly attachedWindows = new Set<number>()

  constructor(
    private readonly recentFiles: RecentFilesStore,
    private readonly onRecentFilesChanged: (recentFiles: RecentFile[]) => void,
    private readonly options: DocumentServiceOptions = {},
  ) {}

  newDocument(parentWindow: BrowserWindow): { content: string } {
    this.attachWindowCleanup(parentWindow)
    return { content: '' }
  }

  getCurrentPath(parentWindow: BrowserWindow): string | undefined {
    return this.currentPaths.get(parentWindow.webContents.id)
  }

  getAuthorizedDocumentPath(
    parentWindow: BrowserWindow,
    requestedPath: string,
  ): string | undefined {
    return this.authorizedPaths
      .get(parentWindow.webContents.id)
      ?.find((authorizedPath) => areSameFilePaths(authorizedPath, requestedPath))
  }

  isPathAuthorized(parentWindow: BrowserWindow, requestedPath: string): boolean {
    return this.getAuthorizedDocumentPath(parentWindow, requestedPath) !== undefined
  }

  releaseDocumentPath(parentWindow: BrowserWindow, requestedPath: string): void {
    const windowId = parentWindow.webContents.id
    const authorized = this.authorizedPaths.get(windowId)
    if (!authorized) return
    const authorizedPath = authorized.find((candidate) =>
      areSameFilePaths(candidate, requestedPath),
    )
    if (!authorizedPath) return

    const remaining = authorized.filter((candidate) => !areSameFilePaths(candidate, authorizedPath))
    this.authorizedPaths.set(windowId, remaining)
    this.options.watcher?.unwatchFile(windowId, authorizedPath)
    const currentPath = this.currentPaths.get(windowId)
    if (currentPath && areSameFilePaths(currentPath, authorizedPath)) {
      const nextCurrentPath = remaining.at(-1)
      if (nextCurrentPath) this.currentPaths.set(windowId, nextCurrentPath)
      else this.currentPaths.delete(windowId)
    }
  }

  authorizeDocumentPath(
    parentWindow: BrowserWindow,
    filePath: string,
    relativePath?: string,
  ): void {
    this.attachWindowCleanup(parentWindow)
    const windowId = parentWindow.webContents.id
    const authorized = this.authorizedPaths.get(windowId) ?? []
    if (!authorized.some((item) => areSameFilePaths(item, filePath))) {
      authorized.push(filePath)
      this.authorizedPaths.set(windowId, authorized)
    }
    this.currentPaths.set(windowId, filePath)
    this.options.watcher?.watchFile(
      this.createWatchRecipient(parentWindow),
      filePath,
      relativePath ?? this.options.getWorkspaceRelativePath?.(parentWindow, filePath),
    )
  }

  handleWorkspaceEntryRenamed(
    parentWindow: BrowserWindow,
    previousPath: string,
    nextPath: string,
  ): void {
    const windowId = parentWindow.webContents.id
    const authorized = this.authorizedPaths.get(windowId)
    if (!authorized) return
    let changed = false
    const nextAuthorized = authorized.map((authorizedPath) => {
      const relation = relative(resolve(previousPath), resolve(authorizedPath))
      const isAffected =
        relation === '' ||
        (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
      if (!isAffected) return authorizedPath
      changed = true
      this.options.watcher?.unwatchFile(windowId, authorizedPath)
      const mappedPath = relation ? resolve(nextPath, relation) : nextPath
      this.options.watcher?.watchFile(
        this.createWatchRecipient(parentWindow),
        mappedPath,
        this.options.getWorkspaceRelativePath?.(parentWindow, mappedPath),
      )
      return mappedPath
    })
    if (!changed) return
    this.authorizedPaths.set(windowId, nextAuthorized)
    const currentPath = this.currentPaths.get(windowId)
    if (currentPath) {
      const mappedCurrent = nextAuthorized.find(
        (candidate, index) =>
          areSameFilePaths(authorized[index], currentPath) && candidate !== authorized[index],
      )
      if (mappedCurrent) this.currentPaths.set(windowId, mappedCurrent)
    }
  }

  handleWorkspaceEntryDeleted(parentWindow: BrowserWindow, deletedPath: string): void {
    const windowId = parentWindow.webContents.id
    const authorized = this.authorizedPaths.get(windowId)
    if (!authorized) return
    const remaining = authorized.filter((authorizedPath) => {
      const relation = relative(resolve(deletedPath), resolve(authorizedPath))
      const isAffected =
        relation === '' ||
        (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
      if (isAffected) this.options.watcher?.unwatchFile(windowId, authorizedPath)
      return !isAffected
    })
    this.authorizedPaths.set(windowId, remaining)
    const currentPath = this.currentPaths.get(windowId)
    if (currentPath && !remaining.some((item) => areSameFilePaths(item, currentPath))) {
      this.currentPaths.delete(windowId)
    }
  }

  async flushRecentFiles(): Promise<void> {
    await this.recentFiles.whenIdle()
  }

  async openDocument(
    parentWindow: BrowserWindow,
    request: OpenDocumentRequest,
  ): Promise<OpenDocumentResult> {
    let filePath = request.filePath

    if (filePath) {
      const requestedFilePath = filePath
      let isAuthorized = this.isPathAuthorized(parentWindow, requestedFilePath)
      if (!isAuthorized && this.options.canOpenPath) {
        isAuthorized = await this.options.canOpenPath(parentWindow, requestedFilePath)
      }
      if (!isAuthorized) {
        let isRecentFile: boolean
        try {
          isRecentFile = await this.recentFiles.hasFile(requestedFilePath)
        } catch (error) {
          this.logDetailedError('recent', requestedFilePath, error)
          await this.showFileError(parentWindow, '打开', requestedFilePath)
          return { canceled: false, error: true }
        }
        if (!isRecentFile) {
          await this.showFileError(parentWindow, '打开', filePath)
          return { canceled: false, error: true }
        }
      }
    }

    if (!filePath) {
      const selection = await dialog.showOpenDialog(parentWindow, {
        title: '打开 Markdown 文件',
        properties: ['openFile'],
        filters: DOCUMENT_FILTERS,
      })

      if (selection.canceled || selection.filePaths.length === 0) return { canceled: true }
      filePath = selection.filePaths[0]
    }

    if (!isSupportedDocumentPath(filePath)) {
      await this.showUnsupportedFileError(parentWindow, '打开', filePath)
      return { canceled: false, error: true }
    }

    try {
      const content = await readUtf8Document(filePath)
      this.authorizeDocumentPath(parentWindow, filePath)
      void this.rememberFile(filePath)
      return { canceled: false, filePath, content }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        void this.forgetFile(filePath)
      }
      this.logDetailedError('open', filePath, error)
      await this.showFileError(parentWindow, '打开', filePath)
      return { canceled: false, error: true }
    }
  }

  async saveDocument(
    parentWindow: BrowserWindow,
    request: SaveDocumentRequest,
  ): Promise<SaveDocumentResult> {
    let filePath = request.saveAs ? undefined : request.filePath

    if (filePath) {
      const authorizedPath = this.getAuthorizedDocumentPath(parentWindow, filePath)
      if (!authorizedPath) {
        this.logDetailedError(
          'save',
          filePath,
          new Error('Renderer requested an unauthorized path.'),
        )
        return { canceled: false, error: true }
      }
      filePath = authorizedPath
    }

    if (!filePath) {
      const selection = await dialog.showSaveDialog(parentWindow, {
        title: request.saveAs ? '另存为' : '保存 Markdown 文件',
        defaultPath: request.filePath ?? '未命名.md',
        filters: DOCUMENT_FILTERS,
      })

      if (selection.canceled || !selection.filePath) return { canceled: true }
      filePath = withDefaultMarkdownExtension(selection.filePath)
    }

    if (!isSupportedDocumentPath(filePath)) {
      await this.showUnsupportedFileError(parentWindow, '保存', filePath)
      return { canceled: false, error: true }
    }
    if (
      request.forbiddenFilePaths?.some((forbiddenPath) => areSameFilePaths(forbiddenPath, filePath))
    ) {
      await dialog.showMessageBox(parentWindow, {
        type: 'warning',
        title: '文件已在其他标签中打开',
        message: `无法保存为“${getFileNameFromPath(filePath) ?? '该文件'}”。`,
        detail: '同一路径只能打开一个标签。请选择其他文件名，或先关闭已有标签。',
      })
      return { canceled: false, error: true }
    }

    try {
      this.options.watcher?.markSelfSave(filePath, request.content)
      await writeUtf8Document(filePath, request.content)
      this.authorizeDocumentPath(parentWindow, filePath)
      void this.rememberFile(filePath)
      return { canceled: false, filePath }
    } catch (error) {
      this.options.watcher?.clearSelfSave(filePath)
      this.logDetailedError('save', filePath, error)
      await this.showFileError(parentWindow, '保存', filePath)
      return { canceled: false, error: true }
    }
  }

  async confirmClose(
    parentWindow: BrowserWindow,
    request: ConfirmCloseRequest,
  ): Promise<ConfirmCloseResult> {
    const documentName = getFileNameFromPath(request.filePath) ?? '未命名文档'
    const confirmation = await dialog.showMessageBox(parentWindow, {
      type: 'warning',
      title: '未保存的修改',
      message: `是否保存对“${documentName}”的修改？`,
      detail: '如果不保存，所做的修改将丢失。',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })

    if (confirmation.response === 1) return { action: 'discard' }
    if (confirmation.response !== 0) return { action: 'cancel' }

    const saveResult = await this.saveDocument(parentWindow, {
      filePath: request.filePath,
      content: request.content,
      forbiddenFilePaths: request.forbiddenFilePaths,
    })
    if (saveResult.canceled || saveResult.error || !saveResult.filePath) {
      return { action: 'cancel' }
    }

    return { action: 'save', filePath: saveResult.filePath }
  }

  private async showUnsupportedFileError(
    parentWindow: BrowserWindow,
    operation: '打开' | '保存',
    filePath: string,
  ): Promise<void> {
    await dialog.showMessageBox(parentWindow, {
      type: 'error',
      title: '不支持的文件类型',
      message: `无法${operation}“${getFileNameFromPath(filePath) ?? '所选文件'}”。`,
      detail: 'OpenMD 仅支持 .md、.markdown 和 .txt 文件。',
    })
  }

  private async showFileError(
    parentWindow: BrowserWindow,
    operation: '打开' | '保存',
    filePath: string,
  ): Promise<void> {
    await dialog.showMessageBox(parentWindow, {
      type: 'error',
      title: `${operation}文件失败`,
      message: `无法${operation}“${getFileNameFromPath(filePath) ?? '该文件'}”。`,
      detail:
        operation === '打开'
          ? '请确认文件仍然存在，并且 OpenMD 有权读取该文件。'
          : '请确认目标位置可写、磁盘空间充足，然后重试。',
    })
  }

  private async rememberFile(filePath: string): Promise<void> {
    try {
      const recentFiles = await this.recentFiles.addFile(filePath)
      this.onRecentFilesChanged(recentFiles)
    } catch (error) {
      this.logDetailedError('recent', filePath, error)
    }
  }

  private attachWindowCleanup(parentWindow: BrowserWindow): void {
    const windowId = parentWindow.webContents.id
    if (this.attachedWindows.has(windowId)) return
    this.attachedWindows.add(windowId)
    parentWindow.once('closed', () => {
      this.currentPaths.delete(windowId)
      this.authorizedPaths.delete(windowId)
      this.attachedWindows.delete(windowId)
      this.options.watcher?.unwatchRecipient(windowId)
    })
  }

  private createWatchRecipient(parentWindow: BrowserWindow): FileWatchRecipient {
    return {
      id: parentWindow.webContents.id,
      emit: (change) => {
        if (!parentWindow.isDestroyed() && !parentWindow.webContents.isDestroyed()) {
          parentWindow.webContents.send(IPC_CHANNELS.workspaceFileChanged, change)
        }
      },
    }
  }

  private async forgetFile(filePath: string): Promise<void> {
    try {
      const recentFiles = await this.recentFiles.removeFile(filePath)
      this.onRecentFilesChanged(recentFiles)
    } catch (error) {
      this.logDetailedError('recent', filePath, error)
    }
  }

  private logDetailedError(
    operation: 'open' | 'save' | 'recent',
    filePath: string,
    error: unknown,
  ): void {
    if (!app.isPackaged) console.error(`Failed to ${operation} document at ${filePath}:`, error)
  }
}
