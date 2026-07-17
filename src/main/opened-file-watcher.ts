import { watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, normalize, resolve } from 'node:path'

import type { WorkspaceFileChange } from '../shared/desktop-api.types'

const WATCH_DEBOUNCE_MS = 120
const SELF_SAVE_SUPPRESSION_MS = 3_000

export interface FileWatchRecipient {
  id: number
  emit: (change: WorkspaceFileChange) => void
}

interface RegisteredRecipient {
  recipient: FileWatchRecipient
  relativePath: string
}

interface WatchedFile {
  filePath: string
  directoryIdentity: string
  recipients: Map<number, RegisteredRecipient>
  timer?: ReturnType<typeof setTimeout>
  generation: number
  lastType?: WorkspaceFileChange['type']
  lastContent?: string
  lastMtimeMs?: number
}

interface WatchedDirectory {
  watcher: FSWatcher
  fileIdentities: Set<string>
}

interface SelfSaveSuppression {
  content: string
  expiresAt: number
}

function pathIdentity(filePath: string): string {
  const normalized = normalize(resolve(filePath))
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export async function inspectWatchedFile(
  filePath: string,
  relativePath: string,
): Promise<WorkspaceFileChange> {
  try {
    const [content, fileStats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
    return {
      type: 'changed',
      filePath,
      relativePath,
      mtimeMs: fileStats.mtimeMs,
      content,
    }
  } catch (error) {
    if (isMissingPathError(error)) return { type: 'deleted', filePath, relativePath }
    throw error
  }
}

export function shouldSuppressSelfSave(
  actualContent: string | undefined,
  suppression: Readonly<SelfSaveSuppression> | undefined,
  now = Date.now(),
): boolean {
  return Boolean(
    suppression &&
      suppression.expiresAt >= now &&
      actualContent !== undefined &&
      actualContent === suppression.content,
  )
}

export class OpenedFileWatcher {
  private readonly watchedFiles = new Map<string, WatchedFile>()
  private readonly watchedDirectories = new Map<string, WatchedDirectory>()
  private readonly selfSaves = new Map<string, SelfSaveSuppression>()

  watchFile(recipient: FileWatchRecipient, filePath: string, relativePath?: string): void {
    const identity = pathIdentity(filePath)
    const registeredRecipient: RegisteredRecipient = {
      recipient,
      relativePath: relativePath ?? basename(filePath),
    }
    const existing = this.watchedFiles.get(identity)
    if (existing) {
      existing.recipients.set(recipient.id, registeredRecipient)
      return
    }

    const directoryPath = dirname(filePath)
    const directoryIdentity = pathIdentity(directoryPath)
    const watchedDirectory = this.ensureDirectoryWatch(directoryPath, directoryIdentity)
    if (!watchedDirectory) return

    const watchedFile: WatchedFile = {
      filePath,
      directoryIdentity,
      recipients: new Map([[recipient.id, registeredRecipient]]),
      generation: 0,
    }
    watchedDirectory.fileIdentities.add(identity)
    this.watchedFiles.set(identity, watchedFile)
  }

  unwatchFile(recipientId: number, filePath: string): void {
    const identity = pathIdentity(filePath)
    const watchedFile = this.watchedFiles.get(identity)
    if (!watchedFile) return
    watchedFile.recipients.delete(recipientId)
    if (watchedFile.recipients.size === 0) this.closeWatchedFile(identity, watchedFile)
  }

  unwatchRecipient(recipientId: number): void {
    for (const [identity, watchedFile] of this.watchedFiles) {
      watchedFile.recipients.delete(recipientId)
      if (watchedFile.recipients.size === 0) this.closeWatchedFile(identity, watchedFile)
    }
  }

  markSelfSave(filePath: string, content: string): void {
    this.selfSaves.set(pathIdentity(filePath), {
      content,
      expiresAt: Date.now() + SELF_SAVE_SUPPRESSION_MS,
    })
  }

  clearSelfSave(filePath: string): void {
    this.selfSaves.delete(pathIdentity(filePath))
  }

  close(): void {
    for (const [identity, watchedFile] of this.watchedFiles) {
      this.closeWatchedFile(identity, watchedFile)
    }
    this.selfSaves.clear()
  }

  private scheduleInspection(identity: string): void {
    const watchedFile = this.watchedFiles.get(identity)
    if (!watchedFile) return
    watchedFile.generation += 1
    const generation = watchedFile.generation
    if (watchedFile.timer) clearTimeout(watchedFile.timer)
    watchedFile.timer = setTimeout(() => {
      watchedFile.timer = undefined
      void this.inspect(identity, watchedFile, generation)
    }, WATCH_DEBOUNCE_MS)
  }

  private async inspect(
    identity: string,
    watchedFile: WatchedFile,
    generation: number,
  ): Promise<void> {
    const firstRecipient = watchedFile.recipients.values().next().value as
      | RegisteredRecipient
      | undefined
    if (!firstRecipient) return

    let change: WorkspaceFileChange
    try {
      change = await inspectWatchedFile(watchedFile.filePath, firstRecipient.relativePath)
    } catch {
      return
    }
    if (this.watchedFiles.get(identity) !== watchedFile || watchedFile.generation !== generation) {
      return
    }

    const suppression = this.selfSaves.get(identity)
    if (suppression && suppression.expiresAt < Date.now()) this.selfSaves.delete(identity)
    if (change.type === 'changed' && shouldSuppressSelfSave(change.content, suppression)) {
      this.selfSaves.delete(identity)
      watchedFile.lastType = change.type
      watchedFile.lastContent = change.content
      watchedFile.lastMtimeMs = change.mtimeMs
      return
    }

    if (
      change.type === watchedFile.lastType &&
      change.content === watchedFile.lastContent &&
      change.mtimeMs === watchedFile.lastMtimeMs
    ) {
      return
    }
    watchedFile.lastType = change.type
    watchedFile.lastContent = change.content
    watchedFile.lastMtimeMs = change.mtimeMs

    for (const { recipient, relativePath } of watchedFile.recipients.values()) {
      recipient.emit({ ...change, relativePath })
    }
  }

  private closeWatchedFile(identity: string, watchedFile: WatchedFile): void {
    if (watchedFile.timer) clearTimeout(watchedFile.timer)
    this.watchedFiles.delete(identity)
    const watchedDirectory = this.watchedDirectories.get(watchedFile.directoryIdentity)
    if (!watchedDirectory) return
    watchedDirectory.fileIdentities.delete(identity)
    if (watchedDirectory.fileIdentities.size === 0) {
      watchedDirectory.watcher.close()
      this.watchedDirectories.delete(watchedFile.directoryIdentity)
    }
  }

  private ensureDirectoryWatch(
    directoryPath: string,
    directoryIdentity: string,
  ): WatchedDirectory | undefined {
    const existing = this.watchedDirectories.get(directoryIdentity)
    if (existing) return existing

    let watcher: FSWatcher
    try {
      watcher = watch(directoryPath, { persistent: false }, (_eventType, changedName) => {
        const directory = this.watchedDirectories.get(directoryIdentity)
        if (!directory) return
        if (changedName) {
          const changedIdentity = pathIdentity(resolve(directoryPath, changedName.toString()))
          if (directory.fileIdentities.has(changedIdentity)) {
            this.scheduleInspection(changedIdentity)
          }
          return
        }
        for (const fileIdentity of directory.fileIdentities) {
          this.scheduleInspection(fileIdentity)
        }
      })
    } catch {
      return undefined
    }

    const watchedDirectory: WatchedDirectory = { watcher, fileIdentities: new Set() }
    watcher.on('error', () => {
      for (const fileIdentity of watchedDirectory.fileIdentities) {
        this.scheduleInspection(fileIdentity)
      }
    })
    this.watchedDirectories.set(directoryIdentity, watchedDirectory)
    return watchedDirectory
  }
}
