import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type {
  ClearRecoveryRecordRequest,
  RecoverySnapshot,
  RecoveryTabBackup,
  RecoveryTabSnapshot,
  SaveRecoverySessionRequest,
  WorkspaceInfo,
} from '../shared/desktop-api.types'

const RECOVERY_SCHEMA_VERSION = 1
const MAX_RECOVERY_TABS = 200
const MAX_RECOVERY_DOCUMENT_BYTES = 100 * 1024 * 1024

interface StoredRecoveryRecord {
  schemaVersion: number
  tabId: string
  title: string
  originalPath?: string
  backedUpAt: number
  summary: string
  content: string
}

interface StoredSessionTab {
  id: string
  title: string
  originalPath?: string
  dirty: boolean
  editorMode: 'visual' | 'source'
  scrollPosition?: number
  cursorAnchor?: RecoveryTabSnapshot['cursorAnchor']
  recordFile?: string
}

interface StoredRecoverySession {
  schemaVersion: number
  generation: number
  updatedAt: number
  workspace?: WorkspaceInfo
  activeTabId?: string
  tabs: StoredSessionTab[]
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function recoverySummary(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/gu, ' [代码块] ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1 [图片]')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>|[#>*_~`|\-[\]]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return Array.from(text).slice(0, 180).join('') || '（空白文档）'
}

function recordFileName(tabId: string, generation: number): string {
  const digest = createHash('sha256').update(tabId).digest('hex').slice(0, 32)
  return `${digest}-${generation}-${randomUUID()}.json`
}

function sessionFileName(generation: number): string {
  return `session-${generation}-${randomUUID()}.json`
}

function isWorkspaceInfo(value: unknown): value is WorkspaceInfo {
  if (!value || typeof value !== 'object') return false
  const workspace = value as Partial<WorkspaceInfo>
  return typeof workspace.name === 'string' && typeof workspace.rootPath === 'string'
}

function parseStoredSession(value: unknown): StoredRecoverySession | undefined {
  if (!value || typeof value !== 'object') return undefined
  const session = value as Partial<StoredRecoverySession>
  if (
    session.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
    !Array.isArray(session.tabs) ||
    session.tabs.length > MAX_RECOVERY_TABS
  ) {
    return undefined
  }

  const tabs: StoredSessionTab[] = []
  for (const candidate of session.tabs) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      typeof candidate.id !== 'string' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.dirty !== 'boolean' ||
      (candidate.editorMode !== 'visual' && candidate.editorMode !== 'source')
    ) {
      continue
    }
    tabs.push({
      id: candidate.id,
      title: candidate.title,
      originalPath: typeof candidate.originalPath === 'string' ? candidate.originalPath : undefined,
      dirty: candidate.dirty,
      editorMode: candidate.editorMode,
      scrollPosition:
        typeof candidate.scrollPosition === 'number' ? candidate.scrollPosition : undefined,
      cursorAnchor:
        candidate.cursorAnchor && typeof candidate.cursorAnchor === 'object'
          ? candidate.cursorAnchor
          : undefined,
      recordFile:
        typeof candidate.recordFile === 'string' ? basename(candidate.recordFile) : undefined,
    })
  }

  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    generation:
      typeof session.generation === 'number'
        ? session.generation
        : (typeof session.updatedAt === 'number' ? session.updatedAt : 0) * 1_000,
    updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
    workspace: isWorkspaceInfo(session.workspace) ? session.workspace : undefined,
    activeTabId: typeof session.activeTabId === 'string' ? session.activeTabId : undefined,
    tabs,
  }
}

function parseStoredRecord(value: unknown): StoredRecoveryRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<StoredRecoveryRecord>
  if (
    record.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
    typeof record.tabId !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.backedUpAt !== 'number' ||
    typeof record.summary !== 'string' ||
    typeof record.content !== 'string' ||
    Buffer.byteLength(record.content, 'utf8') > MAX_RECOVERY_DOCUMENT_BYTES
  ) {
    return undefined
  }
  return {
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    tabId: record.tabId,
    title: record.title,
    originalPath: typeof record.originalPath === 'string' ? record.originalPath : undefined,
    backedUpAt: record.backedUpAt,
    summary: record.summary,
    content: record.content,
  }
}

/**
 * Persists crash recovery only below Electron's userData directory. The service
 * has no network dependencies and never writes to a document's original path.
 */
export class RecoveryService {
  private operationQueue: Promise<void> = Promise.resolve()
  private lastGeneration = 0

  constructor(
    readonly directoryPath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async getSnapshot(): Promise<RecoverySnapshot> {
    return this.enqueue(async () => this.readSnapshot())
  }

  async saveSession(request: SaveRecoverySessionRequest): Promise<void> {
    return this.enqueue(async () => {
      const tabs = request.tabs.slice(0, MAX_RECOVERY_TABS)
      await mkdir(this.recordsDirectory, { recursive: true })
      const now = this.now()
      const generation = this.nextGeneration(now)
      const activeRecordFiles = new Set<string>()
      const storedTabs: StoredSessionTab[] = []

      for (const tab of tabs) {
        const shouldRecover = tab.dirty || !tab.filePath
        let recordFile: string | undefined
        if (shouldRecover) {
          if (Buffer.byteLength(tab.markdown, 'utf8') > MAX_RECOVERY_DOCUMENT_BYTES) {
            throw new TypeError(`“${tab.title}”超过单个恢复记录 100 MB 限制。`)
          }
          recordFile = recordFileName(tab.id, generation)
          activeRecordFiles.add(recordFile)
          const record: StoredRecoveryRecord = {
            schemaVersion: RECOVERY_SCHEMA_VERSION,
            tabId: tab.id,
            title: tab.title,
            originalPath: tab.filePath,
            backedUpAt: now,
            summary: recoverySummary(tab.markdown),
            content: tab.markdown,
          }
          await this.atomicWriteJson(join(this.recordsDirectory, recordFile), record)
        }

        storedTabs.push({
          id: tab.id,
          title: tab.title,
          originalPath: tab.filePath,
          dirty: tab.dirty,
          editorMode: tab.editorMode,
          scrollPosition: tab.scrollPosition,
          cursorAnchor: tab.cursorAnchor,
          recordFile,
        })
      }

      const session: StoredRecoverySession = {
        schemaVersion: RECOVERY_SCHEMA_VERSION,
        generation,
        updatedAt: now,
        workspace: request.workspace,
        activeTabId: request.activeTabId,
        tabs: storedTabs,
      }
      const activeSessionFile = sessionFileName(generation)
      await this.atomicWriteJson(join(this.directoryPath, activeSessionFile), session)
      await this.removeStaleSessions(activeSessionFile)
      await this.removeStaleRecords(activeRecordFiles)
    })
  }

  async clearRecord(request: ClearRecoveryRecordRequest): Promise<void> {
    return this.enqueue(async () => {
      const session = await this.readSession()
      if (!session) return
      const tab = session.tabs.find((candidate) => candidate.id === request.tabId)
      if (!tab?.recordFile) return
      const fileName = tab.recordFile
      tab.recordFile = undefined
      tab.dirty = false
      const now = this.now()
      const generation = this.nextGeneration(now)
      session.generation = generation
      session.updatedAt = now
      const activeSessionFile = sessionFileName(generation)
      await this.atomicWriteJson(join(this.directoryPath, activeSessionFile), session)
      await this.removeStaleSessions(activeSessionFile)
      await rm(join(this.recordsDirectory, fileName), { force: true }).catch(() => undefined)
    })
  }

  async discard(): Promise<void> {
    return this.enqueue(async () => {
      await rm(this.directoryPath, { recursive: true, force: true })
    })
  }

  async completeSession(): Promise<void> {
    await this.discard()
  }

  async getRecoverableWorkspace(): Promise<WorkspaceInfo | undefined> {
    const snapshot = await this.getSnapshot()
    return snapshot.available ? snapshot.workspace : undefined
  }

  private get recordsDirectory(): string {
    return join(this.directoryPath, 'records')
  }

  private nextGeneration(timestamp: number): number {
    this.lastGeneration = Math.max(this.lastGeneration + 1, timestamp * 1_000)
    return this.lastGeneration
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async readSnapshot(): Promise<RecoverySnapshot> {
    const session = await this.readSession()
    if (!session) return { available: false, tabs: [] }

    const tabs: RecoveryTabSnapshot[] = []
    for (const tab of session.tabs) {
      let record: StoredRecoveryRecord | undefined
      if (tab.recordFile) {
        try {
          record = parseStoredRecord(
            JSON.parse(
              await readFile(join(this.recordsDirectory, tab.recordFile), 'utf8'),
            ) as unknown,
          )
        } catch {
          record = undefined
        }
      }
      tabs.push({
        id: tab.id,
        title: tab.title,
        originalPath: tab.originalPath,
        dirty: tab.dirty,
        editorMode: tab.editorMode,
        scrollPosition: tab.scrollPosition,
        cursorAnchor: tab.cursorAnchor,
        backedUpAt: record?.backedUpAt,
        summary: record?.summary,
        content: record?.content,
      })
    }

    const recoverableTabs = tabs.filter((tab) => tab.content !== undefined || tab.originalPath)
    return {
      available: recoverableTabs.length > 0 || Boolean(session.workspace),
      workspace: session.workspace,
      activeTabId: session.activeTabId,
      tabs: recoverableTabs,
    }
  }

  private async readSession(): Promise<StoredRecoverySession | undefined> {
    let entries: string[]
    try {
      entries = await readdir(this.directoryPath)
    } catch (error) {
      if (isMissingFileError(error)) return undefined
      throw error
    }

    let latest: StoredRecoverySession | undefined
    for (const entry of entries) {
      if (entry !== 'session.json' && !/^session-\d+-[\da-f-]+\.json$/u.test(entry)) continue
      const filePath = join(this.directoryPath, entry)
      try {
        const session = parseStoredSession(JSON.parse(await readFile(filePath, 'utf8')) as unknown)
        if (!session) {
          await rm(filePath, { force: true }).catch(() => undefined)
          continue
        }
        this.lastGeneration = Math.max(this.lastGeneration, session.generation)
        if (!latest || session.generation > latest.generation) latest = session
      } catch {
        await rm(filePath, { force: true }).catch(() => undefined)
      }
    }
    return latest
  }

  private async removeStaleSessions(activeFile: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.directoryPath)
    } catch {
      return
    }
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry !== activeFile &&
            (entry === 'session.json' || /^session-\d+-[\da-f-]+\.json$/u.test(entry)),
        )
        .map((entry) => rm(join(this.directoryPath, entry), { force: true })),
    )
  }

  private async removeStaleRecords(activeFiles: ReadonlySet<string>): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(this.recordsDirectory)
    } catch {
      return
    }
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json') && !activeFiles.has(entry))
        .map((entry) => rm(join(this.recordsDirectory, entry), { force: true })),
    )
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(this.directoryPath, { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
    const serialized = `${JSON.stringify(value, null, 2)}\n`
    try {
      await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      let lastError: unknown
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rename(temporaryPath, filePath)
          return
        } catch (error) {
          lastError = error
          await new Promise((resolveRetry) => setTimeout(resolveRetry, 20 * 2 ** attempt))
        }
      }
      throw lastError
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

export function recoveryTabFromBackup(tab: RecoveryTabBackup): RecoveryTabSnapshot {
  return {
    id: tab.id,
    title: tab.title,
    originalPath: tab.filePath,
    dirty: tab.dirty,
    editorMode: tab.editorMode,
    scrollPosition: tab.scrollPosition,
    cursorAnchor: tab.cursorAnchor,
    summary: recoverySummary(tab.markdown),
    content: tab.markdown,
  }
}
