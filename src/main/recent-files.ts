import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, normalize, resolve } from 'node:path'

import type { RecentFile } from '../shared/desktop-api.types'
import { getFileNameFromPath } from '../shared/document-utils'

export const RECENT_FILE_LIMIT = 10
const RECENT_FILE_STAT_TIMEOUT_MS = 1000

function pathIdentity(filePath: string): string {
  const normalized = normalize(resolve(filePath))
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

export function areSameFilePaths(left: string, right: string): boolean {
  return pathIdentity(left) === pathIdentity(right)
}

function isRecentFile(value: unknown): value is RecentFile {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Partial<RecentFile>
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.lastOpenedAt === 'number'
  )
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function logRecentFilesError(message: string, error: unknown): void {
  if (process.env.NODE_ENV === 'development') console.error(message, error)
}

async function inspectRecentFile(recentFile: RecentFile): Promise<RecentFile | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const inspection = stat(recentFile.path)
    .then((fileStats) => (fileStats.isFile() ? recentFile : undefined))
    .catch((error: unknown) => {
      if (isMissingFileError(error)) return undefined
      logRecentFilesError(`Failed to inspect recent file ${recentFile.path}:`, error)
      return recentFile
    })
  const timeoutResult = new Promise<RecentFile>((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout(recentFile), RECENT_FILE_STAT_TIMEOUT_MS)
  })

  try {
    return await Promise.race([inspection, timeoutResult])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function deduplicateAndLimitRecentFiles(
  recentFiles: readonly RecentFile[],
  limit = RECENT_FILE_LIMIT,
): RecentFile[] {
  const seen = new Set<string>()
  const result: RecentFile[] = []
  const sorted = [...recentFiles].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)

  for (const recentFile of sorted) {
    const identity = pathIdentity(recentFile.path)
    if (seen.has(identity)) continue

    seen.add(identity)
    result.push(recentFile)
    if (result.length === limit) break
  }

  return result
}

export class RecentFilesStore {
  private operationQueue: Promise<void> = Promise.resolve()
  private knownFiles: RecentFile[] | undefined

  constructor(
    private readonly storageFilePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async getRecentFiles(): Promise<RecentFile[]> {
    return this.enqueueOperation(() => this.getRecentFilesInternal())
  }

  async hasFile(filePath: string): Promise<boolean> {
    const recentFiles = this.knownFiles ?? (await this.readStoredFiles())
    this.knownFiles ??= deduplicateAndLimitRecentFiles(recentFiles)
    return this.knownFiles.some((recentFile) => areSameFilePaths(recentFile.path, filePath))
  }

  async whenIdle(): Promise<void> {
    await this.operationQueue
  }

  async addFile(filePath: string): Promise<RecentFile[]> {
    return this.enqueueOperation(async () => {
      const recentFiles = this.knownFiles ?? (await this.readStoredFiles())
      const next = deduplicateAndLimitRecentFiles([
        {
          path: filePath,
          name: getFileNameFromPath(filePath) ?? filePath,
          lastOpenedAt: this.now(),
        },
        ...recentFiles,
      ])

      await this.writeStoredFiles(next)
      this.knownFiles = next
      return next
    })
  }

  async removeFile(filePath: string): Promise<RecentFile[]> {
    return this.enqueueOperation(async () => {
      const identity = pathIdentity(filePath)
      const recentFiles = this.knownFiles ?? (await this.readStoredFiles())
      const next = recentFiles.filter((recentFile) => pathIdentity(recentFile.path) !== identity)
      await this.writeStoredFiles(next)
      this.knownFiles = next
      return next
    })
  }

  private async enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async getRecentFilesInternal(): Promise<RecentFile[]> {
    const stored = await this.readStoredFiles()
    this.knownFiles = deduplicateAndLimitRecentFiles(stored)
    const existingChecks = await Promise.all(stored.map(inspectRecentFile))
    const existing = existingChecks.filter((item): item is RecentFile => item !== undefined)
    const normalized = deduplicateAndLimitRecentFiles(existing)

    if (normalized.length !== stored.length) {
      try {
        await this.writeStoredFiles(normalized)
      } catch (error) {
        logRecentFilesError('Failed to persist cleaned recent files:', error)
      }
    }
    this.knownFiles = normalized
    return normalized
  }

  private async readStoredFiles(): Promise<RecentFile[]> {
    try {
      const content = await readFile(this.storageFilePath, 'utf8')
      const parsed: unknown = JSON.parse(content)
      return Array.isArray(parsed) ? parsed.filter(isRecentFile) : []
    } catch (error) {
      if (!isMissingFileError(error)) logRecentFilesError('Failed to read recent files:', error)
      return []
    }
  }

  private async writeStoredFiles(recentFiles: readonly RecentFile[]): Promise<void> {
    await mkdir(dirname(this.storageFilePath), { recursive: true })
    await writeFile(this.storageFilePath, JSON.stringify(recentFiles, null, 2), 'utf8')
  }
}
