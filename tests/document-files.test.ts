import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  readUtf8Document,
  withDefaultMarkdownExtension,
  writeUtf8Document,
} from '../src/main/document-files'

describe('document files', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-document-files-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('round-trips Markdown as UTF-8 without changing its content', async () => {
    const filePath = join(temporaryDirectory, '往返测试.md')
    const markdown = '# 中文标题\n\nOpenMD preserves emoji 🚀 and accents café.\n'

    await writeUtf8Document(filePath, markdown)

    await expect(readUtf8Document(filePath)).resolves.toBe(markdown)
  })

  it('atomically replaces an existing UTF-8 document', async () => {
    const filePath = join(temporaryDirectory, 'existing.md')
    await writeUtf8Document(filePath, 'old content')

    await writeUtf8Document(filePath, '新内容 🚀')

    await expect(readUtf8Document(filePath)).resolves.toBe('新内容 🚀')
  })

  it('adds the default Markdown extension only when no extension exists', () => {
    expect(withDefaultMarkdownExtension(join(temporaryDirectory, 'untitled'))).toBe(
      join(temporaryDirectory, 'untitled.md'),
    )
    expect(withDefaultMarkdownExtension(join(temporaryDirectory, 'notes.markdown'))).toBe(
      join(temporaryDirectory, 'notes.markdown'),
    )
    expect(withDefaultMarkdownExtension(join(temporaryDirectory, 'plain.txt'))).toBe(
      join(temporaryDirectory, 'plain.txt'),
    )
  })
})
