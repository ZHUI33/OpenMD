import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

export const DEFAULT_WORKSPACE_IGNORES = Object.freeze([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.DS_Store',
  'Thumbs.db',
] as const)

const DEFAULT_WORKSPACE_IGNORE_SET = new Set<string>(DEFAULT_WORKSPACE_IGNORES)
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export class WorkspacePathError extends Error {
  readonly code = 'invalid-workspace-path'

  constructor(message = '路径必须位于当前工作区内。') {
    super(message)
    this.name = 'WorkspacePathError'
  }
}

function comparablePath(filePath: string): string {
  const normalized = resolve(filePath)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

/**
 * Performs a lexical boundary check. Existing paths must additionally be checked with
 * {@link resolveExistingWorkspacePath} so a symlink cannot escape the workspace.
 */
export function isPathWithinWorkspace(rootPath: string, candidatePath: string): boolean {
  const root = comparablePath(rootPath)
  const candidate = comparablePath(candidatePath)
  const relation = relative(root, candidate)
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  )
}

export function isIgnoredWorkspaceEntry(name: string): boolean {
  if (DEFAULT_WORKSPACE_IGNORE_SET.has(name)) return true
  if (process.platform === 'win32') {
    const normalized = name.toLocaleLowerCase('en-US')
    return [...DEFAULT_WORKSPACE_IGNORE_SET].some(
      (ignored) => ignored.toLocaleLowerCase('en-US') === normalized,
    )
  }
  return false
}

export function toWorkspaceRelativePath(rootPath: string, filePath: string): string {
  if (!isPathWithinWorkspace(rootPath, filePath)) throw new WorkspacePathError()
  return relative(resolve(rootPath), resolve(filePath)).split(sep).join('/')
}

export function resolveWorkspacePath(rootPath: string, relativePath = ''): string {
  if (isAbsolute(relativePath)) throw new WorkspacePathError()
  const candidate = resolve(rootPath, relativePath)
  if (!isPathWithinWorkspace(rootPath, candidate)) throw new WorkspacePathError()
  return candidate
}

export async function resolveExistingWorkspacePath(
  rootPath: string,
  relativePath = '',
): Promise<string> {
  const realRoot = await realpath(rootPath)
  const lexicalCandidate = resolveWorkspacePath(realRoot, relativePath)
  const realCandidate = await realpath(lexicalCandidate)
  if (!isPathWithinWorkspace(realRoot, realCandidate)) throw new WorkspacePathError()
  return realCandidate
}

export function validateWorkspaceEntryName(name: string): string {
  if (
    !name ||
    name !== name.trim() ||
    name === '.' ||
    name === '..' ||
    name.includes('\0') ||
    basename(name) !== name ||
    name.includes('/') ||
    name.includes('\\') ||
    WINDOWS_RESERVED_NAME.test(name) ||
    /[. ]$/.test(name)
  ) {
    throw new WorkspacePathError('名称无效，且不能包含路径分隔符。')
  }
  if (isIgnoredWorkspaceEntry(name)) {
    throw new WorkspacePathError('该名称属于 OpenMD 默认忽略项。')
  }
  return name
}

export async function resolveNewWorkspacePath(
  rootPath: string,
  parentRelativePath: string | undefined,
  name: string,
): Promise<string> {
  const parentPath = await resolveExistingWorkspacePath(rootPath, parentRelativePath ?? '')
  const candidate = resolve(parentPath, validateWorkspaceEntryName(name))
  if (!isPathWithinWorkspace(await realpath(rootPath), candidate)) throw new WorkspacePathError()
  return candidate
}
