import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { RecoveryService } from '../src/main/recovery-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('RecoveryService', () => {
  it('atomically stores local draft records and never writes the original document', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmd-recovery-'))
    temporaryDirectories.push(root)
    const originalPath = join(root, 'original.md')
    await writeFile(originalPath, 'disk version', 'utf8')
    const recoveryDirectory = join(root, 'user-data', 'recovery')
    const service = new RecoveryService(recoveryDirectory, () => 1_753_603_200_000)

    await service.saveSession({
      workspace: { name: 'Notes', rootPath: root },
      activeTabId: 'dirty-tab',
      tabs: [
        {
          id: 'dirty-tab',
          title: 'original.md',
          filePath: originalPath,
          markdown: '# Draft\n\nLocal unsaved changes.',
          dirty: true,
          editorMode: 'visual',
          scrollPosition: 144,
        },
        {
          id: 'untitled-tab',
          title: '未命名',
          markdown: 'An unnamed draft',
          dirty: true,
          editorMode: 'source',
        },
      ],
    })

    expect(await readFile(originalPath, 'utf8')).toBe('disk version')
    const snapshot = await service.getSnapshot()
    expect(snapshot.available).toBe(true)
    expect(snapshot.workspace).toEqual({ name: 'Notes', rootPath: root })
    expect(snapshot.activeTabId).toBe('dirty-tab')
    expect(snapshot.tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dirty-tab',
          originalPath,
          backedUpAt: 1_753_603_200_000,
          summary: 'Draft Local unsaved changes.',
          content: '# Draft\n\nLocal unsaved changes.',
          scrollPosition: 144,
        }),
        expect.objectContaining({
          id: 'untitled-tab',
          originalPath: undefined,
          content: 'An unnamed draft',
        }),
      ]),
    )

    const files = await readdir(join(recoveryDirectory, 'records'))
    expect(files).toHaveLength(2)
    expect(files.every((file) => file.endsWith('.json'))).toBe(true)
    expect((await readdir(recoveryDirectory)).some((file) => file.endsWith('.tmp'))).toBe(false)
  })

  it('clears the matching backup after save and removes the session on clean completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmd-recovery-clear-'))
    temporaryDirectories.push(root)
    const originalPath = join(root, 'saved.md')
    await mkdir(root, { recursive: true })
    await writeFile(originalPath, 'saved', 'utf8')
    const service = new RecoveryService(join(root, 'recovery'), () => 42)

    await service.saveSession({
      activeTabId: 'saved-tab',
      tabs: [
        {
          id: 'saved-tab',
          title: 'saved.md',
          filePath: originalPath,
          markdown: 'unsaved',
          dirty: true,
          editorMode: 'source',
        },
      ],
    })
    await service.clearRecord({ tabId: 'saved-tab' })
    const afterSave = await service.getSnapshot()
    expect(afterSave.tabs[0]).toMatchObject({
      id: 'saved-tab',
      originalPath,
      content: undefined,
      dirty: false,
    })

    await service.completeSession()
    expect(await service.getSnapshot()).toEqual({ available: false, tabs: [] })
  })

  it('publishes a new immutable generation before removing the previous snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openmd-recovery-generations-'))
    temporaryDirectories.push(root)
    const recoveryDirectory = join(root, 'recovery')
    let now = 100
    const service = new RecoveryService(recoveryDirectory, () => now)
    const tab = {
      id: 'draft',
      title: 'Draft',
      dirty: true,
      editorMode: 'source' as const,
    }

    await service.saveSession({
      activeTabId: tab.id,
      tabs: [{ ...tab, markdown: 'first generation' }],
    })
    now += 1
    await service.saveSession({
      activeTabId: tab.id,
      tabs: [{ ...tab, markdown: 'second generation' }],
    })

    expect((await service.getSnapshot()).tabs[0]?.content).toBe('second generation')
    expect(
      (await readdir(recoveryDirectory)).filter((entry) => entry.startsWith('session-')),
    ).toHaveLength(1)
    expect(await readdir(join(recoveryDirectory, 'records'))).toHaveLength(1)
  })
})
