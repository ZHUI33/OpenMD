import { realpath, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { clipboard, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'

import type {
  CreateWorkspaceEntryRequest,
  DeleteWorkspaceEntryResult,
  ListWorkspaceDirectoryRequest,
  OpenWorkspaceResult,
  RenameWorkspaceEntryRequest,
  WorkspaceEntry,
  WorkspaceFileResult,
  WorkspaceInfo,
  WorkspacePathRequest,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '../shared/desktop-api.types'
import {
  createWorkspaceDirectory,
  createWorkspaceMarkdownFile,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveWorkspaceEntry,
} from './workspace-files'
import {
  isPathWithinWorkspace,
  toWorkspaceRelativePath,
  WorkspacePathError,
} from './workspace-paths'
import { searchWorkspaceFiles } from './workspace-search'

interface WorkspaceState extends WorkspaceInfo {
  rootPath: string
}

const DOCUMENT_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

export class WorkspaceService {
  private readonly workspaces = new Map<number, WorkspaceState>()
  private readonly activeSearches = new Map<number, AbortController>()
  private readonly attachedWindows = new Set<number>()

  async open(parentWindow: BrowserWindow): Promise<OpenWorkspaceResult> {
    const selection = await dialog.showOpenDialog(parentWindow, {
      title: '打开文件夹工作区',
      properties: ['openDirectory'],
    })
    if (selection.canceled || selection.filePaths.length === 0) return { canceled: true }

    const rootPath = await realpath(selection.filePaths[0])
    const rootStats = await stat(rootPath)
    if (!rootStats.isDirectory()) throw new WorkspacePathError('所选路径不是文件夹。')

    const workspace: WorkspaceState = { name: basename(rootPath), rootPath }
    this.attachWindowCleanup(parentWindow)
    this.abortSearch(parentWindow.webContents.id)
    this.workspaces.set(parentWindow.webContents.id, workspace)
    return { canceled: false, workspace: { ...workspace } }
  }

  getCurrent(parentWindow: BrowserWindow): WorkspaceInfo | undefined {
    const workspace = this.workspaces.get(parentWindow.webContents.id)
    return workspace ? { ...workspace } : undefined
  }

  async listDirectory(
    parentWindow: BrowserWindow,
    request: ListWorkspaceDirectoryRequest = {},
  ): Promise<WorkspaceEntry[]> {
    return listWorkspaceDirectory(this.getRequiredRoot(parentWindow), request)
  }

  async readFile(
    parentWindow: BrowserWindow,
    request: WorkspacePathRequest,
  ): Promise<WorkspaceFileResult> {
    return readWorkspaceFile(this.getRequiredRoot(parentWindow), request)
  }

  async createMarkdownFile(
    parentWindow: BrowserWindow,
    request: CreateWorkspaceEntryRequest,
  ): Promise<WorkspaceEntry> {
    return createWorkspaceMarkdownFile(this.getRequiredRoot(parentWindow), request)
  }

  async createDirectory(
    parentWindow: BrowserWindow,
    request: CreateWorkspaceEntryRequest,
  ): Promise<WorkspaceEntry> {
    return createWorkspaceDirectory(this.getRequiredRoot(parentWindow), request)
  }

  async renameEntry(
    parentWindow: BrowserWindow,
    request: RenameWorkspaceEntryRequest,
  ): Promise<WorkspaceEntry> {
    return renameWorkspaceEntry(this.getRequiredRoot(parentWindow), request)
  }

  async deleteEntry(
    parentWindow: BrowserWindow,
    request: WorkspacePathRequest,
  ): Promise<DeleteWorkspaceEntryResult> {
    const rootPath = this.getRequiredRoot(parentWindow)
    const entry = await resolveWorkspaceEntry(rootPath, request)
    const confirmation = await dialog.showMessageBox(parentWindow, {
      type: 'warning',
      title: '删除文件',
      message: `确定要删除“${basename(entry.filePath)}”吗？`,
      detail: '此操作无法由 OpenMD 撤销。',
      buttons: ['删除', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmation.response !== 0) return { deleted: false }

    await deleteWorkspaceEntry(rootPath, request)
    return { deleted: true }
  }

  async revealEntry(parentWindow: BrowserWindow, request: WorkspacePathRequest): Promise<void> {
    const entry = await resolveWorkspaceEntry(this.getRequiredRoot(parentWindow), request)
    shell.showItemInFolder(entry.filePath)
  }

  async copyRelativePath(
    parentWindow: BrowserWindow,
    request: WorkspacePathRequest,
  ): Promise<void> {
    const entry = await resolveWorkspaceEntry(this.getRequiredRoot(parentWindow), request)
    clipboard.writeText(entry.relativePath)
  }

  async search(
    parentWindow: BrowserWindow,
    request: WorkspaceSearchRequest,
  ): Promise<WorkspaceSearchResult> {
    const windowId = parentWindow.webContents.id
    this.abortSearch(windowId)
    const controller = new AbortController()
    this.activeSearches.set(windowId, controller)
    try {
      return await searchWorkspaceFiles(
        this.getRequiredRoot(parentWindow),
        request,
        controller.signal,
      )
    } finally {
      if (this.activeSearches.get(windowId) === controller) this.activeSearches.delete(windowId)
    }
  }

  async isDocumentPathAllowed(parentWindow: BrowserWindow, filePath: string): Promise<boolean> {
    const workspace = this.workspaces.get(parentWindow.webContents.id)
    if (!workspace || !DOCUMENT_EXTENSIONS.has(extname(filePath).toLocaleLowerCase('en-US'))) {
      return false
    }
    if (!isPathWithinWorkspace(workspace.rootPath, filePath)) return false
    try {
      const actualPath = await realpath(filePath)
      const fileStats = await stat(actualPath)
      return fileStats.isFile() && isPathWithinWorkspace(workspace.rootPath, actualPath)
    } catch {
      return false
    }
  }

  getRelativePath(parentWindow: BrowserWindow, filePath: string): string | undefined {
    const workspace = this.workspaces.get(parentWindow.webContents.id)
    if (!workspace || !isPathWithinWorkspace(workspace.rootPath, filePath)) return undefined
    return toWorkspaceRelativePath(workspace.rootPath, filePath)
  }

  async resolveEntryPath(
    parentWindow: BrowserWindow,
    request: WorkspacePathRequest,
  ): Promise<string> {
    return (await resolveWorkspaceEntry(this.getRequiredRoot(parentWindow), request)).filePath
  }

  releaseWindow(parentWindow: BrowserWindow): void {
    const windowId = parentWindow.webContents.id
    this.abortSearch(windowId)
    this.workspaces.delete(windowId)
    this.attachedWindows.delete(windowId)
  }

  private getRequiredRoot(parentWindow: BrowserWindow): string {
    const workspace = this.workspaces.get(parentWindow.webContents.id)
    if (!workspace) throw new WorkspacePathError('请先打开一个文件夹工作区。')
    return workspace.rootPath
  }

  private abortSearch(windowId: number): void {
    this.activeSearches.get(windowId)?.abort()
    this.activeSearches.delete(windowId)
  }

  private attachWindowCleanup(parentWindow: BrowserWindow): void {
    const windowId = parentWindow.webContents.id
    if (this.attachedWindows.has(windowId)) return
    this.attachedWindows.add(windowId)
    parentWindow.once('closed', () => this.releaseWindow(parentWindow))
  }
}
