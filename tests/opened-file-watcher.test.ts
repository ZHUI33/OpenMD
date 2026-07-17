import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { inspectWatchedFile, shouldSuppressSelfSave } from '../src/main/opened-file-watcher'

describe('opened file change snapshots', () => {
  let rootPath: string
  let filePath: string

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'openmd-watch-'))
    filePath = join(rootPath, 'article.md')
    await writeFile(filePath, 'initial', 'utf8')
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
  })

  it('classifies an external modification with disk content and mtime', async () => {
    await writeFile(filePath, 'changed outside', 'utf8')

    await expect(inspectWatchedFile(filePath, 'article.md')).resolves.toMatchObject({
      type: 'changed',
      filePath,
      relativePath: 'article.md',
      content: 'changed outside',
      mtimeMs: expect.any(Number),
    })
  })

  it('classifies a removed file explicitly', async () => {
    await rm(filePath)

    await expect(inspectWatchedFile(filePath, 'article.md')).resolves.toEqual({
      type: 'deleted',
      filePath,
      relativePath: 'article.md',
    })
  })

  it('suppresses only the matching OpenMD save within its time window', () => {
    const suppression = { content: 'saved by OpenMD', expiresAt: 2_000 }

    expect(shouldSuppressSelfSave('saved by OpenMD', suppression, 1_999)).toBe(true)
    expect(shouldSuppressSelfSave('external edit', suppression, 1_999)).toBe(false)
    expect(shouldSuppressSelfSave('saved by OpenMD', suppression, 2_001)).toBe(false)
    expect(shouldSuppressSelfSave(undefined, suppression, 1_999)).toBe(false)
  })
})
