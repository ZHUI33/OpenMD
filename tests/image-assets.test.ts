import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getImageAssetDirectoryName,
  getImageAssetDirectoryPath,
  ImageAssetError,
  parseRemoteImageUrl,
  prepareImageBytes,
  resolveMarkdownImagePath,
  sanitizeImageFileName,
  sanitizeSvg,
  toMarkdownRelativePath,
  withImageFilenameSuffix,
  writeImageAsset,
} from '../src/main/image-assets'

const MINIMAL_PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('image asset path utilities', () => {
  it.each([
    ['C:\\writing\\README.md', 'README.assets', 'C:\\writing\\README.assets'],
    [
      '/Users/openmd/文章/article.v1.md',
      'article.v1.assets',
      '/Users/openmd/文章/article.v1.assets',
    ],
  ])('derives the sidecar directory for %s', (documentPath, directoryName, directoryPath) => {
    expect(getImageAssetDirectoryName(documentPath)).toBe(directoryName)
    expect(getImageAssetDirectoryPath(documentPath)).toBe(directoryPath)
  })

  it('cleans portable illegal characters and path components from file names', () => {
    const now = new Date(2026, 6, 10, 20, 30, 1)

    expect(sanitizeImageFileName('..\\architecture:plan?2026*.PNG', 'png', now)).toBe(
      'architecture-plan-2026-.png',
    )
    expect(sanitizeImageFileName('..\\CON.jpeg', 'jpeg', now)).toBe('_CON.jpeg')
    expect(sanitizeImageFileName('CON.preview.png', 'png', now)).toBe('_CON.preview.png')
    expect(sanitizeImageFileName(undefined, 'png', now)).toBe('image-20260710-203001.png')
  })

  it('adds deterministic suffixes without changing the extension', () => {
    expect(withImageFilenameSuffix('architecture.png', 0)).toBe('architecture.png')
    expect(withImageFilenameSuffix('architecture.png', 1)).toBe('architecture-2.png')
    expect(withImageFilenameSuffix('architecture.png', 2)).toBe('architecture-3.png')
  })

  it('converts Windows and macOS paths to URI-encoded Markdown relative paths', () => {
    expect(
      toMarkdownRelativePath('C:\\writing\\article.md', 'C:\\writing\\article.assets\\架构 图.png'),
    ).toBe('article.assets/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png')
    expect(
      toMarkdownRelativePath(
        '/Users/openmd/文章/article.md',
        '/Users/openmd/文章/article.assets/architecture.png',
      ),
    ).toBe('article.assets/architecture.png')
  })

  it('decodes Markdown URI paths and accepts either slash style', () => {
    expect(
      resolveMarkdownImagePath(
        'C:\\writing\\article.md',
        'article.assets\\%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png',
      ),
    ).toBe('C:\\writing\\article.assets\\架构 图.png')
  })

  it.each([
    '../secret.png',
    'article.assets/../../secret.png',
    'article.assets/%2e%2e/secret.png',
    'C:\\secret.png',
    '/etc/secret.png',
    'javascript:alert(1)',
  ])('blocks an unsafe local image path: %s', (source) => {
    expect(() => resolveMarkdownImagePath('/Users/openmd/article.md', source)).toThrow(
      ImageAssetError,
    )
  })

  it('only recognizes HTTP and HTTPS remote image URLs', () => {
    expect(parseRemoteImageUrl('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    )
    expect(parseRemoteImageUrl('http://example.com/image.png')).toBe('http://example.com/image.png')
    expect(parseRemoteImageUrl('javascript:alert(1)')).toBeUndefined()
    expect(parseRemoteImageUrl('file:///tmp/image.png')).toBeUndefined()
  })
})

describe('image asset file operations', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-image-assets-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('writes into the document sidecar directory and de-duplicates names', async () => {
    const documentPath = join(temporaryDirectory, 'article.md')
    await writeFile(documentPath, '# Article')
    const image = prepareImageBytes(MINIMAL_PNG, 'png')

    const first = await writeImageAsset(documentPath, 'architecture.png', image)
    const second = await writeImageAsset(documentPath, 'architecture.png', image)

    expect(first.relativePath).toBe('article.assets/architecture.png')
    expect(second.relativePath).toBe('article.assets/architecture-2.png')
    await expect(readFile(first.absolutePath)).resolves.toEqual(Buffer.from(MINIMAL_PNG))
    await expect(readFile(second.absolutePath)).resolves.toEqual(Buffer.from(MINIMAL_PNG))
  })

  it('rejects bytes that do not match the requested image extension', () => {
    expect(() => prepareImageBytes(MINIMAL_PNG, 'jpg')).toThrowError('图片内容与文件扩展名不匹配。')
  })

  it('removes active SVG content and external references', () => {
    const unsafeSvg = Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <style>path { fill: url(https://example.com/a.png) }</style>
        <a href="javascript:alert(1)"><path d="M0 0h10v10z" /></a>
        <path fill="url('https://example.com/a b.png')" d="M0 0h1v1z" />
        <use href="#safe-shape" />
      </svg>
    `)

    const sanitized = sanitizeSvg(unsafeSvg).toString('utf8')
    expect(sanitized).not.toMatch(/script|onload|<style|javascript:|https:\/\/example.com/i)
    expect(sanitized).toContain('href="#safe-shape"')
    expect(sanitized).toContain('<path')
  })

  it('rejects SVG entity declarations instead of attempting to expand them', () => {
    const svg = Buffer.from(
      '<!DOCTYPE svg [<!ENTITY payload SYSTEM "file:///etc/passwd">]><svg>&payload;</svg>',
    )
    expect(() => sanitizeSvg(svg)).toThrow(ImageAssetError)
  })

  it.each([
    ['x', 'script'],
    ['x', 'foreignObject'],
    ['脚本', 'script'],
  ])('rejects namespace-prefixed SVG %s:%s elements', (prefix, element) => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:${prefix}="http://www.w3.org/2000/svg"><${prefix}:${element}>unsafe</${prefix}:${element}></svg>`,
    )
    expect(() => sanitizeSvg(svg)).toThrowError('SVG 图片包含无法安全验证的命名空间元素。')
  })

  it('does not trust namespace aliases for external href attributes', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:foo="http://www.w3.org/1999/xlink"><image foo:href="https://example.com/tracker.png" /></svg>',
    )
    const sanitized = sanitizeSvg(svg).toString('utf8')
    expect(sanitized).not.toContain('foo:href')
    expect(sanitized).not.toContain('https://example.com/tracker.png')
  })

  it('removes Unicode namespace aliases from attributes', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:链接="http://www.w3.org/1999/xlink"><image 链接:href="https://example.com/tracker.png" /></svg>',
    )
    const sanitized = sanitizeSvg(svg).toString('utf8')
    expect(sanitized).not.toContain('链接:href')
    expect(sanitized).not.toContain('https://example.com/tracker.png')
  })
})
