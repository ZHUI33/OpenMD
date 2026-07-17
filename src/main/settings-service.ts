import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { AppSettings, AppSettingsUpdate } from '../shared/settings'
import {
  applySettingsUpdate,
  DEFAULT_SETTINGS,
  migrateSettings,
  SETTINGS_SCHEMA_VERSION,
} from '../shared/settings'

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function isReplaceError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES'
}

function settingsEqual(left: unknown, right: AppSettings): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

/** Versioned JSON settings persisted below Electron's userData directory. */
export class SettingsService {
  private cache: AppSettings | undefined
  private operationQueue: Promise<void> = Promise.resolve()
  private temporaryFileCounter = 0

  constructor(private readonly storageFilePath: string) {}

  get filePath(): string {
    return this.storageFilePath
  }

  async getSettings(): Promise<AppSettings> {
    return this.enqueue(async () => {
      if (this.cache) return { ...this.cache }

      const stored = await this.readStoredSettings()
      const settings = migrateSettings(stored.value)
      this.cache = settings

      if (stored.exists && !settingsEqual(stored.value, settings)) {
        await this.writeStoredSettings(settings)
      }
      return { ...settings }
    })
  }

  async updateSettings(value: unknown): Promise<AppSettings> {
    return this.enqueue(async () => {
      const current = this.cache ?? migrateSettings((await this.readStoredSettings()).value)
      const updated = applySettingsUpdate(current, value)
      await this.writeStoredSettings(updated)
      this.cache = updated
      return { ...updated }
    })
  }

  async resetSettings(): Promise<AppSettings> {
    return this.enqueue(async () => {
      const settings: AppSettings = {
        ...DEFAULT_SETTINGS,
        schemaVersion: SETTINGS_SCHEMA_VERSION,
      }
      await this.writeStoredSettings(settings)
      this.cache = settings
      return { ...settings }
    })
  }

  async whenIdle(): Promise<void> {
    await this.operationQueue
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async readStoredSettings(): Promise<{ exists: boolean; value: unknown }> {
    let source: string
    try {
      source = await readFile(this.storageFilePath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) return { exists: false, value: undefined }
      // A temporarily unreadable file should not prevent startup; a later update
      // will surface an actionable write error if the condition persists.
      return { exists: false, value: undefined }
    }

    try {
      return { exists: true, value: JSON.parse(source) as unknown }
    } catch {
      // Malformed JSON is repaired immediately with validated defaults.
      return { exists: true, value: undefined }
    }
  }

  private async writeStoredSettings(settings: Readonly<AppSettings>): Promise<void> {
    await mkdir(dirname(this.storageFilePath), { recursive: true })
    this.temporaryFileCounter += 1
    const temporaryFilePath = `${this.storageFilePath}.${process.pid}.${this.temporaryFileCounter}.tmp`
    const serialized = `${JSON.stringify(settings, null, 2)}\n`

    try {
      await writeFile(temporaryFilePath, serialized, { encoding: 'utf8', mode: 0o600 })
      try {
        await rename(temporaryFilePath, this.storageFilePath)
      } catch (error) {
        if (!isReplaceError(error)) throw error
        // Windows may reject replacing an existing file with rename(). Writing the
        // validated payload directly is the narrow fallback; the temp file remains
        // available until the operation has succeeded.
        await writeFile(this.storageFilePath, serialized, { encoding: 'utf8', mode: 0o600 })
      }
    } finally {
      await rm(temporaryFilePath, { force: true }).catch(() => undefined)
    }
  }
}

export type { AppSettingsUpdate }
