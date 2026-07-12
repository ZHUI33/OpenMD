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
import { readUtf8Document, withDefaultMarkdownExtension, writeUtf8Document } from './document-files'
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

export class DocumentService {
  private readonly currentPaths = new Map<number, string>()

  constructor(
    private readonly recentFiles: RecentFilesStore,
    private readonly onRecentFilesChanged: (recentFiles: RecentFile[]) => void,
  ) {}

  newDocument(parentWindow: BrowserWindow): { content: string } {
    this.currentPaths.delete(parentWindow.webContents.id)
    return { content: '' }
  }

  getCurrentPath(parentWindow: BrowserWindow): string | undefined {
    return this.currentPaths.get(parentWindow.webContents.id)
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
      const currentPath = this.currentPaths.get(parentWindow.webContents.id)
      if (!currentPath || !areSameFilePaths(currentPath, requestedFilePath)) {
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
      this.currentPaths.set(parentWindow.webContents.id, filePath)
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
      const currentPath = this.currentPaths.get(parentWindow.webContents.id)
      if (!currentPath || !areSameFilePaths(currentPath, filePath)) {
        this.logDetailedError(
          'save',
          filePath,
          new Error('Renderer requested an unauthorized path.'),
        )
        return { canceled: false, error: true }
      }
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

    try {
      await writeUtf8Document(filePath, request.content)
      this.currentPaths.set(parentWindow.webContents.id, filePath)
      void this.rememberFile(filePath)
      return { canceled: false, filePath }
    } catch (error) {
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
