import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { moveWorkspaceEntryToTrash } from '../src/main/workspace-service'

describe('workspace recycle-bin deletion', () => {
  let rootPath: string
  let filePath: string

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'openmd-trash-'))
    filePath = join(rootPath, 'draft.md')
    await writeFile(filePath, '# keep me')
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
  })

  it('passes the validated existing path to the system trash operation', async () => {
    const trashItem = vi.fn(async (targetPath: string) => {
      expect(targetPath).toBe(filePath)
      await rm(targetPath)
    })

    await moveWorkspaceEntryToTrash(rootPath, { relativePath: 'draft.md' }, trashItem)

    expect(trashItem).toHaveBeenCalledOnce()
    await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not permanently delete when the system trash operation fails', async () => {
    const trashItem = vi.fn(async () => {
      throw new Error('trash unavailable')
    })

    await expect(
      moveWorkspaceEntryToTrash(rootPath, { relativePath: 'draft.md' }, trashItem),
    ).rejects.toThrow(/原项目没有被删除/)

    await expect(access(filePath)).resolves.toBeUndefined()
  })
})
