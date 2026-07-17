import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createWorkspaceDirectory,
  createWorkspaceMarkdownFile,
  deleteWorkspaceEntry,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspaceEntry,
} from '../src/main/workspace-files'
import {
  DEFAULT_WORKSPACE_IGNORES,
  isIgnoredWorkspaceEntry,
  isPathWithinWorkspace,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
} from '../src/main/workspace-paths'

describe('workspace path security and lazy directory listing', () => {
  let rootPath: string

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'openmd-workspace-'))
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
  })

  it('rejects lexical paths outside the workspace root', async () => {
    const siblingPath = resolve(rootPath, '..', 'outside.md')

    expect(isPathWithinWorkspace(rootPath, join(rootPath, 'notes', 'today.md'))).toBe(true)
    expect(isPathWithinWorkspace(rootPath, siblingPath)).toBe(false)
    expect(() => resolveWorkspacePath(rootPath, '../outside.md')).toThrow(/工作区/)
    await expect(resolveExistingWorkspacePath(rootPath, '..')).rejects.toThrow(/工作区/)
  })

  it('applies every default ignore rule', () => {
    expect(DEFAULT_WORKSPACE_IGNORES).toEqual([
      '.git',
      'node_modules',
      'dist',
      'build',
      '.DS_Store',
      'Thumbs.db',
    ])
    for (const name of DEFAULT_WORKSPACE_IGNORES) {
      expect(isIgnoredWorkspaceEntry(name)).toBe(true)
    }
    expect(isIgnoredWorkspaceEntry('article.md')).toBe(false)
  })

  it('lists one directory level, hides ignored and unsupported files, and opts into text', async () => {
    await Promise.all([
      mkdir(join(rootPath, '.git')),
      mkdir(join(rootPath, 'node_modules')),
      mkdir(join(rootPath, 'docs')),
      writeFile(join(rootPath, 'README.md'), '# Readme'),
      writeFile(join(rootPath, 'guide.markdown'), '# Guide'),
      writeFile(join(rootPath, 'notes.txt'), 'plain text'),
      writeFile(join(rootPath, 'cover.png'), 'not really an image'),
    ])
    await writeFile(join(rootPath, 'docs', 'nested.md'), '# Nested')

    const markdownOnly = await listWorkspaceDirectory(rootPath)
    expect(markdownOnly.map((entry) => [entry.name, entry.kind])).toEqual([
      ['docs', 'directory'],
      ['guide.markdown', 'markdown'],
      ['README.md', 'markdown'],
    ])
    expect(markdownOnly.some((entry) => entry.relativePath.includes('nested.md'))).toBe(false)

    const withText = await listWorkspaceDirectory(rootPath, { includeTextFiles: true })
    expect(withText.some((entry) => entry.name === 'notes.txt' && entry.kind === 'text')).toBe(true)
    await expect(listWorkspaceDirectory(rootPath, { relativePath: 'docs' })).resolves.toMatchObject(
      [{ name: 'nested.md', relativePath: 'docs/nested.md', kind: 'markdown' }],
    )
  })

  it('keeps create, read, rename and delete operations inside the root', async () => {
    const folder = await createWorkspaceDirectory(rootPath, { name: 'articles' })
    expect(folder).toMatchObject({ relativePath: 'articles', kind: 'directory' })

    const created = await createWorkspaceMarkdownFile(rootPath, {
      parentRelativePath: 'articles',
      name: 'draft',
    })
    expect(created).toMatchObject({ relativePath: 'articles/draft.md', kind: 'markdown' })
    await expect(
      readWorkspaceFile(rootPath, { relativePath: created.relativePath }),
    ).resolves.toMatchObject({ content: '', relativePath: 'articles/draft.md' })

    const renamed = await renameWorkspaceEntry(rootPath, {
      relativePath: created.relativePath,
      newName: 'published.markdown',
    })
    expect(renamed).toMatchObject({
      relativePath: 'articles/published.markdown',
      kind: 'markdown',
    })
    await deleteWorkspaceEntry(rootPath, { relativePath: renamed.relativePath })
    await expect(
      readWorkspaceFile(rootPath, { relativePath: renamed.relativePath }),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(
      createWorkspaceMarkdownFile(rootPath, {
        parentRelativePath: '..',
        name: 'escaped.md',
      }),
    ).rejects.toThrow(/工作区/)
  })
})
