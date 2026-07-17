import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import type {
  CreateWorkspaceEntryRequest,
  ListWorkspaceDirectoryRequest,
  RenameWorkspaceEntryRequest,
  WorkspaceEntry,
  WorkspaceEntryKind,
  WorkspaceFileResult,
  WorkspacePathRequest,
} from '../shared/desktop-api.types'
import {
  isIgnoredWorkspaceEntry,
  resolveExistingWorkspacePath,
  resolveNewWorkspacePath,
  resolveWorkspacePath,
  toWorkspaceRelativePath,
  validateWorkspaceEntryName,
  WorkspacePathError,
} from './workspace-paths'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const TEXT_EXTENSIONS = new Set(['.txt'])

function extensionKind(filePath: string): WorkspaceEntryKind | undefined {
  const extension = extname(filePath).toLocaleLowerCase('en-US')
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
  if (TEXT_EXTENSIONS.has(extension)) return 'text'
  return undefined
}

function createWorkspaceEntry(
  rootPath: string,
  filePath: string,
  kind: WorkspaceEntryKind,
): WorkspaceEntry {
  return {
    name: basename(filePath),
    relativePath: toWorkspaceRelativePath(rootPath, filePath),
    filePath,
    kind,
  }
}

async function rejectSymbolicLink(rootPath: string, relativePath: string): Promise<void> {
  const lexicalPath = resolveWorkspacePath(rootPath, relativePath)
  const fileStats = await lstat(lexicalPath)
  if (fileStats.isSymbolicLink()) {
    throw new WorkspacePathError('不允许对工作区符号链接执行此操作。')
  }
}

export async function listWorkspaceDirectory(
  rootPath: string,
  request: ListWorkspaceDirectoryRequest = {},
): Promise<WorkspaceEntry[]> {
  const directoryPath = await resolveExistingWorkspacePath(rootPath, request.relativePath ?? '')
  const directoryStats = await stat(directoryPath)
  if (!directoryStats.isDirectory()) throw new WorkspacePathError('请求的路径不是文件夹。')

  const entries = await readdir(directoryPath, { withFileTypes: true })
  const visible: WorkspaceEntry[] = []
  for (const entry of entries) {
    if (isIgnoredWorkspaceEntry(entry.name) || entry.isSymbolicLink()) continue
    const filePath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      visible.push(createWorkspaceEntry(rootPath, filePath, 'directory'))
      continue
    }
    if (!entry.isFile()) continue
    const kind = extensionKind(entry.name)
    if (kind === 'markdown' || (kind === 'text' && request.includeTextFiles)) {
      visible.push(createWorkspaceEntry(rootPath, filePath, kind))
    }
  }

  return visible.sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (left.kind !== 'directory' && right.kind === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })
}

export async function readWorkspaceFile(
  rootPath: string,
  request: WorkspacePathRequest,
): Promise<WorkspaceFileResult> {
  await rejectSymbolicLink(rootPath, request.relativePath)
  const filePath = await resolveExistingWorkspacePath(rootPath, request.relativePath)
  if (!extensionKind(filePath)) throw new WorkspacePathError('只能读取 Markdown 或文本文件。')
  const fileStats = await stat(filePath)
  if (!fileStats.isFile()) throw new WorkspacePathError('请求的路径不是文件。')
  const content = await readFile(filePath, 'utf8')
  return {
    filePath,
    relativePath: toWorkspaceRelativePath(rootPath, filePath),
    content,
  }
}

export async function createWorkspaceMarkdownFile(
  rootPath: string,
  request: CreateWorkspaceEntryRequest,
): Promise<WorkspaceEntry> {
  let name = validateWorkspaceEntryName(request.name)
  if (!extname(name)) name = `${name}.md`
  if (extensionKind(name) !== 'markdown') {
    throw new WorkspacePathError('新建 Markdown 文件必须使用 .md 或 .markdown 扩展名。')
  }

  const filePath = await resolveNewWorkspacePath(rootPath, request.parentRelativePath, name)
  await writeFile(filePath, '', { encoding: 'utf8', flag: 'wx' })
  return createWorkspaceEntry(rootPath, filePath, 'markdown')
}

export async function createWorkspaceDirectory(
  rootPath: string,
  request: CreateWorkspaceEntryRequest,
): Promise<WorkspaceEntry> {
  const filePath = await resolveNewWorkspacePath(rootPath, request.parentRelativePath, request.name)
  await mkdir(filePath)
  return createWorkspaceEntry(rootPath, filePath, 'directory')
}

export async function renameWorkspaceEntry(
  rootPath: string,
  request: RenameWorkspaceEntryRequest,
): Promise<WorkspaceEntry> {
  if (!request.relativePath) throw new WorkspacePathError('不能重命名工作区根目录。')
  await rejectSymbolicLink(rootPath, request.relativePath)
  const sourcePath = await resolveExistingWorkspacePath(rootPath, request.relativePath)
  const sourceStats = await stat(sourcePath)
  const name = validateWorkspaceEntryName(request.newName)
  const sourceKind = sourceStats.isDirectory() ? 'directory' : extensionKind(sourcePath)
  if (!sourceKind) throw new WorkspacePathError('只能重命名工作区中的 Markdown 或文本文件。')
  const targetKind = sourceKind === 'directory' ? 'directory' : extensionKind(name)
  if (!targetKind) {
    throw new WorkspacePathError('重命名后仍须使用支持的文档扩展名。')
  }

  const targetPath = join(dirname(sourcePath), name)
  try {
    await lstat(targetPath)
    throw new WorkspacePathError('目标名称已存在。')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(sourcePath, targetPath)
  return createWorkspaceEntry(rootPath, targetPath, targetKind)
}

export async function deleteWorkspaceEntry(
  rootPath: string,
  request: WorkspacePathRequest,
): Promise<void> {
  if (!request.relativePath) throw new WorkspacePathError('不能删除工作区根目录。')
  await rejectSymbolicLink(rootPath, request.relativePath)
  const filePath = await resolveExistingWorkspacePath(rootPath, request.relativePath)
  const fileStats = await stat(filePath)
  await rm(filePath, { recursive: fileStats.isDirectory(), force: false })
}

export async function resolveWorkspaceEntry(
  rootPath: string,
  request: WorkspacePathRequest,
): Promise<{ filePath: string; relativePath: string }> {
  await rejectSymbolicLink(rootPath, request.relativePath)
  const filePath = await resolveExistingWorkspacePath(rootPath, request.relativePath)
  return { filePath, relativePath: toWorkspaceRelativePath(rootPath, filePath) }
}
