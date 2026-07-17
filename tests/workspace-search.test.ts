import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  decodeSearchableText,
  parseWorkspaceContentMatches,
  searchWorkspaceFiles,
} from '../src/main/workspace-search'

describe('workspace search result parsing', () => {
  it('rejects binary and invalid UTF-8 payloads even with a text extension', () => {
    expect(decodeSearchableText(Uint8Array.from([0x61, 0, 0x62]))).toBeUndefined()
    expect(decodeSearchableText(Uint8Array.from([0xc3, 0x28]))).toBeUndefined()
    expect(decodeSearchableText(new TextEncoder().encode('正文'))).toBe('正文')
  })

  it('reports one-based lines and columns across newline styles', () => {
    expect(parseWorkspaceContentMatches('Alpha one\r\nbeta ALPHA\rAlpha', 'alpha')).toEqual([
      { lineNumber: 1, column: 1, excerpt: 'Alpha one' },
      { lineNumber: 2, column: 6, excerpt: 'beta ALPHA' },
      { lineNumber: 3, column: 1, excerpt: 'Alpha' },
    ])
  })

  it('honors case sensitivity and a per-call match bound', () => {
    expect(parseWorkspaceContentMatches('Alpha alpha ALPHA', 'Alpha', true)).toEqual([
      { lineNumber: 1, column: 1, excerpt: 'Alpha alpha ALPHA' },
    ])
    expect(parseWorkspaceContentMatches('x x x', 'x', false, 2)).toHaveLength(2)
  })
})

describe('bounded asynchronous workspace search', () => {
  let rootPath: string

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'openmd-search-'))
    await mkdir(join(rootPath, 'docs'))
    await mkdir(join(rootPath, '.git'))
    await writeFile(join(rootPath, 'Alpha-notes.md'), '# Heading\nAlpha body\nalpha again')
    await writeFile(join(rootPath, 'docs', 'guide.markdown'), 'No match\nALPHA in guide')
    await writeFile(join(rootPath, 'docs', 'plain.txt'), 'alpha in text')
    await writeFile(join(rootPath, '.git', 'ignored.md'), 'alpha secret')
    await writeFile(join(rootPath, 'docs', 'image.png'), 'alpha binary asset')
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
  })

  it('searches Markdown names and content while skipping ignores, images and opted-out text', async () => {
    const result = await searchWorkspaceFiles(rootPath, { query: 'alpha' })

    expect(result.truncated).toBe(false)
    expect(result.filesSearched).toBe(2)
    expect(result.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filename',
          relativePath: 'Alpha-notes.md',
          excerpt: 'Alpha-notes.md',
        }),
        expect.objectContaining({
          kind: 'content',
          relativePath: 'Alpha-notes.md',
          lineNumber: 2,
          column: 1,
        }),
        expect.objectContaining({
          kind: 'content',
          relativePath: 'docs/guide.markdown',
          lineNumber: 2,
          column: 1,
        }),
      ]),
    )
    expect(result.matches.some((match) => match.relativePath.includes('.git'))).toBe(false)
    expect(result.matches.some((match) => match.relativePath.endsWith('.png'))).toBe(false)
    expect(result.matches.some((match) => match.relativePath.endsWith('.txt'))).toBe(false)
  })

  it('opts into text files, supports case sensitivity and caps results', async () => {
    const textResult = await searchWorkspaceFiles(rootPath, {
      query: 'alpha',
      includeTextFiles: true,
      caseSensitive: true,
    })
    expect(
      textResult.matches.some(
        (match) => match.relativePath === 'docs/plain.txt' && match.kind === 'content',
      ),
    ).toBe(true)
    expect(
      textResult.matches.some(
        (match) => match.relativePath === 'docs/guide.markdown' && match.kind === 'content',
      ),
    ).toBe(false)

    const limited = await searchWorkspaceFiles(rootPath, {
      query: 'alpha',
      maxResults: 2,
    })
    expect(limited.matches).toHaveLength(2)
    expect(limited.truncated).toBe(true)
  })

  it('returns a canceled result without continuing traversal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      searchWorkspaceFiles(rootPath, { query: 'alpha' }, controller.signal),
    ).resolves.toMatchObject({ canceled: true, filesSearched: 0, matches: [] })
  })
})
