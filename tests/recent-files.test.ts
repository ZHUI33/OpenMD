import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RECENT_FILE_LIMIT, RecentFilesStore } from '../src/main/recent-files'
import type { RecentFile } from '../src/shared/desktop-api.types'

describe('recent files store', () => {
  let temporaryDirectory: string
  let storageFilePath: string
  let timestamp: number
  let store: RecentFilesStore

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-recent-files-'))
    storageFilePath = join(temporaryDirectory, 'user-data', 'recent-files.json')
    timestamp = 1
    store = new RecentFilesStore(storageFilePath, () => timestamp)
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  async function createDocument(relativePath: string, content = 'document body'): Promise<string> {
    const filePath = join(temporaryDirectory, 'documents', relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
    return filePath
  }

  async function readPersistedFiles(): Promise<RecentFile[]> {
    return JSON.parse(await readFile(storageFilePath, 'utf8')) as RecentFile[]
  }

  it('deduplicates the same path, moves it to the front, and persists only metadata', async () => {
    const firstPath = await createDocument('first.md', 'PRIVATE_MARKDOWN_BODY')
    const secondPath = await createDocument('second.md')

    await store.addFile(firstPath)
    timestamp = 2
    await store.addFile(secondPath)
    timestamp = 3
    await store.addFile(firstPath)

    const reloaded = await new RecentFilesStore(storageFilePath).getRecentFiles()
    expect(reloaded).toEqual([
      { path: firstPath, name: 'first.md', lastOpenedAt: 3 },
      { path: secondPath, name: 'second.md', lastOpenedAt: 2 },
    ])
    expect(await readFile(storageFilePath, 'utf8')).not.toContain('PRIVATE_MARKDOWN_BODY')
  })

  it(`persists at most ${RECENT_FILE_LIMIT} entries with the newest first`, async () => {
    const paths: string[] = []

    for (let index = 0; index < RECENT_FILE_LIMIT + 1; index += 1) {
      const filePath = await createDocument(`document-${index}.md`)
      paths.push(filePath)
      timestamp = index + 1
      await store.addFile(filePath)
    }

    const recentFiles = await store.getRecentFiles()
    expect(recentFiles).toHaveLength(RECENT_FILE_LIMIT)
    expect(recentFiles.map((file) => file.path)).toEqual(paths.slice(1).reverse())
    await expect(readPersistedFiles()).resolves.toHaveLength(RECENT_FILE_LIMIT)
  })

  it('serializes concurrent additions without losing entries', async () => {
    const firstPath = await createDocument('concurrent-first.md')
    const secondPath = await createDocument('concurrent-second.md')
    let nextTimestamp = 0
    const concurrentStore = new RecentFilesStore(storageFilePath, () => ++nextTimestamp)

    await Promise.all([concurrentStore.addFile(firstPath), concurrentStore.addFile(secondPath)])

    expect((await concurrentStore.getRecentFiles()).map((file) => file.path)).toEqual([
      secondPath,
      firstPath,
    ])
  })

  it('removes missing files from both the returned list and persisted storage', async () => {
    const existingPath = await createDocument('existing.md')
    const missingPath = await createDocument('deleted.md')

    await store.addFile(existingPath)
    timestamp = 2
    await store.addFile(missingPath)
    await unlink(missingPath)

    expect(await store.getRecentFiles()).toEqual([
      { path: existingPath, name: 'existing.md', lastOpenedAt: 1 },
    ])
    expect(await readPersistedFiles()).toEqual([
      { path: existingPath, name: 'existing.md', lastOpenedAt: 1 },
    ])
  })
})
