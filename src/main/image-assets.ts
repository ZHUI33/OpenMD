import { lstat, mkdir, open, readFile, realpath, rm, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, posix, relative, win32 } from 'node:path'

import type { ImageErrorCode } from '../shared/desktop-api.types'
import { encodeMarkdownPath } from '../shared/image-utils'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const

export type SupportedImageExtension = (typeof SUPPORTED_IMAGE_EXTENSIONS)[number]

const SUPPORTED_EXTENSION_SET = new Set<string>(SUPPORTED_IMAGE_EXTENSIONS)
const MIME_TYPES: Record<SupportedImageExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const REMOTE_SCHEME = /^[a-z][a-z\d+.-]*:/i
const ILLEGAL_FILE_NAME_CHARACTERS = new Set('<>:"/\\|?*')

type PathApi = typeof posix

export class ImageAssetError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ImageAssetError'
  }
}

export interface PreparedImage {
  bytes: Buffer
  extension: SupportedImageExtension
  mimeType: string
}

export interface WrittenImageAsset {
  absolutePath: string
  relativePath: string
}

function pathApiFor(filePath: string): PathApi {
  return /^[a-z]:[\\/]/i.test(filePath) || filePath.includes('\\') ? win32 : posix
}

function isOutside(relativePath: string, pathApi: PathApi): boolean {
  return (
    relativePath === '..' ||
    relativePath.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativePath)
  )
}

function portableBasename(fileName: string): string {
  return fileName.split(/[\\/]/).at(-1) ?? ''
}

function padTimestampPart(value: number): string {
  return String(value).padStart(2, '0')
}

function replaceIllegalFileNameCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f || ILLEGAL_FILE_NAME_CHARACTERS.has(character)
      ? '-'
      : character
  }).join('')
}

export function formatImageTimestamp(now: Date): string {
  return [
    now.getFullYear(),
    padTimestampPart(now.getMonth() + 1),
    padTimestampPart(now.getDate()),
    '-',
    padTimestampPart(now.getHours()),
    padTimestampPart(now.getMinutes()),
    padTimestampPart(now.getSeconds()),
  ].join('')
}

export function getImageAssetDirectoryName(documentPath: string): string {
  const parsed = pathApiFor(documentPath).parse(documentPath)
  return `${parsed.name || 'document'}.assets`
}

export function getImageAssetDirectoryPath(documentPath: string): string {
  const pathApi = pathApiFor(documentPath)
  return pathApi.join(pathApi.dirname(documentPath), getImageAssetDirectoryName(documentPath))
}

export function getSupportedImageExtension(fileName: string): SupportedImageExtension | undefined {
  const extension = extname(portableBasename(fileName)).slice(1).toLocaleLowerCase('en-US')
  return SUPPORTED_EXTENSION_SET.has(extension) ? (extension as SupportedImageExtension) : undefined
}

export function sanitizeImageFileName(
  suggestedName: string | undefined,
  extension: SupportedImageExtension,
  now = new Date(),
): string {
  const leafName = portableBasename(suggestedName ?? '').normalize('NFC')
  const finalDot = leafName.lastIndexOf('.')
  const nameWithoutExtension = finalDot > 0 ? leafName.slice(0, finalDot) : leafName
  let safeName = replaceIllegalFileNameCharacters(nameWithoutExtension)
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim()

  if (!safeName) safeName = `image-${formatImageTimestamp(now)}`
  if (WINDOWS_RESERVED_NAME.test(safeName.split('.')[0] ?? safeName)) safeName = `_${safeName}`

  const maximumStemLength = 120 - extension.length - 1
  safeName = Array.from(safeName)
    .slice(0, maximumStemLength)
    .join('')
    .replace(/[. ]+$/g, '')
  if (!safeName) safeName = `image-${formatImageTimestamp(now)}`

  return `${safeName}.${extension}`
}

export function withImageFilenameSuffix(fileName: string, collisionIndex: number): string {
  if (collisionIndex <= 0) return fileName

  const extensionStart = fileName.lastIndexOf('.')
  const stem = extensionStart > 0 ? fileName.slice(0, extensionStart) : fileName
  const extension = extensionStart > 0 ? fileName.slice(extensionStart) : ''
  return `${stem}-${collisionIndex + 1}${extension}`
}

export function toMarkdownRelativePath(documentPath: string, imagePath: string): string {
  const pathApi = pathApiFor(documentPath)
  const documentDirectory = pathApi.dirname(documentPath)
  const imageRelativePath = pathApi.relative(documentDirectory, imagePath)

  if (!imageRelativePath || isOutside(imageRelativePath, pathApi)) {
    throw new ImageAssetError('invalid-path', '图片路径必须位于当前文档目录内。')
  }

  return encodeMarkdownPath(imageRelativePath)
}

export function parseRemoteImageUrl(source: string): string | undefined {
  if (!REMOTE_SCHEME.test(source)) return undefined

  try {
    const parsed = new URL(source)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return undefined
    }
    return parsed.href
  } catch {
    return undefined
  }
}

export function resolveMarkdownImagePath(documentPath: string, source: string): string {
  const trimmedSource = source.trim()
  if (!trimmedSource || trimmedSource.includes('\0')) {
    throw new ImageAssetError('invalid-path', '图片路径无效。')
  }
  if (REMOTE_SCHEME.test(trimmedSource)) {
    throw new ImageAssetError('invalid-path', '本地图片路径不能包含 URL 协议。')
  }

  let decodedSource: string
  try {
    decodedSource = decodeURIComponent(trimmedSource)
  } catch {
    throw new ImageAssetError('invalid-path', '图片路径包含无效的 URI 编码。')
  }

  const portableSource = decodedSource.replace(/\\/g, '/')
  if (
    posix.isAbsolute(portableSource) ||
    win32.isAbsolute(decodedSource) ||
    /^[a-z]:/i.test(decodedSource)
  ) {
    throw new ImageAssetError('invalid-path', '只允许使用相对于当前文档的图片路径。')
  }

  const segments = portableSource.split('/')
  if (segments.some((segment) => segment === '..')) {
    throw new ImageAssetError('invalid-path', '图片路径不能包含上级目录。')
  }

  const usefulSegments = segments.filter((segment) => segment && segment !== '.')
  if (usefulSegments.length === 0) {
    throw new ImageAssetError('invalid-path', '图片路径无效。')
  }

  const pathApi = pathApiFor(documentPath)
  const documentDirectory = pathApi.dirname(documentPath)
  const imagePath = pathApi.resolve(documentDirectory, ...usefulSegments)
  const imageRelativePath = pathApi.relative(documentDirectory, imagePath)
  if (isOutside(imageRelativePath, pathApi)) {
    throw new ImageAssetError('invalid-path', '图片路径超出了当前文档目录。')
  }

  return imagePath
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  try {
    let source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 16_384))
    source = source.replace(/^\uFEFF/, '').trimStart()
    source = source.replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    source = source.replace(/^(?:<!--[\s\S]*?-->\s*)+/, '')
    if (/^<!doctype\b/i.test(source)) return /<svg(?:\s|>)/i.test(source)
    return /^<svg(?:\s|>)/i.test(source)
  } catch {
    return false
  }
}

export function detectImageExtension(bytes: Uint8Array): SupportedImageExtension | undefined {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png'
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (
    startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'gif'
  }
  if (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'webp'
  }
  return looksLikeSvg(bytes) ? 'svg' : undefined
}

function areCompatibleExtensions(
  expected: SupportedImageExtension,
  detected: SupportedImageExtension,
): boolean {
  if (expected === detected) return true
  return (expected === 'jpg' || expected === 'jpeg') && detected === 'jpg'
}

export function sanitizeSvg(bytes: Uint8Array): Buffer {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch (error) {
    throw new ImageAssetError('unsafe-svg', 'SVG 图片不是有效的 UTF-8 文件。', { cause: error })
  }

  if (!/^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(source)) {
    throw new ImageAssetError('unsafe-svg', 'SVG 图片缺少有效的根元素。')
  }
  if (/<!doctype\b|<!entity\b/i.test(source)) {
    throw new ImageAssetError('unsafe-svg', 'SVG 图片包含不安全的文档声明。')
  }
  if (/<\/?\s*[^\s>/]*:/u.test(source)) {
    throw new ImageAssetError('unsafe-svg', 'SVG 图片包含无法安全验证的命名空间元素。')
  }

  let sanitized = source.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const blockedElements = [
    'script',
    'foreignObject',
    'iframe',
    'object',
    'embed',
    'audio',
    'video',
    'canvas',
    'link',
    'meta',
    'base',
    'style',
    'animate',
    'animateMotion',
    'animateTransform',
    'set',
    'handler',
    'listener',
  ]

  for (const element of blockedElements) {
    const elementName = `(?:[A-Za-z_][\\w.-]*:)?${element}`
    const pairedElement = new RegExp(
      `<${elementName}\\b[^>]*>[\\s\\S]*?<\\/${elementName}\\s*>`,
      'gi',
    )
    const remainingTag = new RegExp(`<\\/?${elementName}\\b[^>]*>`, 'gi')
    sanitized = sanitized.replace(pairedElement, '').replace(remainingTag, '')
  }

  sanitized = sanitized.replace(
    /\s+([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/gu,
    (attribute, attributeName: string, quotedValue: string) => {
      const normalizedName = attributeName.toLocaleLowerCase('en-US')
      const localName = normalizedName.split(':').at(-1) ?? normalizedName
      const value = quotedValue.slice(1, -1).trim()
      if (normalizedName.includes(':')) {
        if (normalizedName.startsWith('xmlns:') || normalizedName === 'xml:space') {
          return attribute
        }
        if (normalizedName === 'xlink:href') return value.startsWith('#') ? attribute : ''
        return ''
      }
      if (/[&\\]/u.test(value)) return ''
      if (localName.startsWith('on') || localName === 'style' || normalizedName === 'xml:base') {
        return ''
      }
      if (localName === 'href' || localName === 'src') {
        return value.startsWith('#') ? attribute : ''
      }
      if (/\b(?:javascript|vbscript|data)\s*:/i.test(value)) return ''

      const urlPattern = /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi
      const urlReferences = [...value.matchAll(urlPattern)]
      if (
        urlReferences.some(
          (match) => !(match[1] ?? match[2] ?? match[3] ?? '').trim().startsWith('#'),
        ) ||
        /url\s*\(/i.test(value.replace(urlPattern, ''))
      ) {
        return ''
      }
      return attribute
    },
  )
  sanitized = sanitized
    .replace(/\s+[^\s=/>]+:[^\s=/>]+\s*=\s*(?!["'])[^\s>]+/gu, '')
    .replace(/\s+on[\w:.-]+\s*=\s*(?!["'])[^\s>]+/gi, '')
    .replace(/\s+(?:href|xlink:href|src|style)\s*=\s*(?!["'])[^\s>]+/gi, '')

  if (
    /<\s*(?:[A-Za-z_][\w.-]*:)?(?:script|foreignObject|iframe|object|embed|handler)\b/i.test(
      sanitized,
    ) ||
    /\son[\w:.-]+\s*=/i.test(sanitized) ||
    /\b(?:javascript|vbscript)\s*:/i.test(sanitized)
  ) {
    throw new ImageAssetError('unsafe-svg', 'SVG 图片包含无法安全移除的活动内容。')
  }

  return Buffer.from(sanitized, 'utf8')
}

export function prepareImageBytes(
  input: Uint8Array,
  expectedExtension?: SupportedImageExtension,
): PreparedImage {
  if (input.byteLength === 0) {
    throw new ImageAssetError('unsupported-image', '图片文件为空。')
  }
  if (input.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageAssetError('image-too-large', '图片不能超过 25 MB。')
  }

  const detectedExtension = detectImageExtension(input)
  if (!detectedExtension) {
    throw new ImageAssetError('unsupported-image', '仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片。')
  }
  if (expectedExtension && !areCompatibleExtensions(expectedExtension, detectedExtension)) {
    throw new ImageAssetError('unsupported-image', '图片内容与文件扩展名不匹配。')
  }

  const extension = expectedExtension ?? detectedExtension
  const bytes = detectedExtension === 'svg' ? sanitizeSvg(input) : Buffer.from(input)
  return { bytes, extension, mimeType: MIME_TYPES[extension] }
}

export function imageToDataUrl(image: PreparedImage): string {
  return `data:${image.mimeType};base64,${image.bytes.toString('base64')}`
}

function unsupportedExtensionIn(fileName: string): boolean {
  return extname(portableBasename(fileName)).length > 0 && !getSupportedImageExtension(fileName)
}

export async function readSupportedImageFile(sourcePath: string): Promise<PreparedImage> {
  if (!sourcePath || !isAbsolute(sourcePath)) {
    throw new ImageAssetError('invalid-path', '图片来源路径无效。')
  }
  const expectedExtension = getSupportedImageExtension(sourcePath)
  if (!expectedExtension || unsupportedExtensionIn(sourcePath)) {
    throw new ImageAssetError('unsupported-image', '仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片。')
  }

  try {
    const sourceStats = await lstat(sourcePath)
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
      throw new ImageAssetError('invalid-path', '所选图片必须是普通文件。')
    }
    if (sourceStats.size > MAX_IMAGE_BYTES) {
      throw new ImageAssetError('image-too-large', '图片不能超过 25 MB。')
    }
    const bytes = await readFile(sourcePath)
    return prepareImageBytes(bytes, expectedExtension)
  } catch (error) {
    if (error instanceof ImageAssetError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ImageAssetError('image-not-found', '找不到所选图片。', { cause: error })
    }
    throw new ImageAssetError('read-failed', '读取图片失败，请确认文件仍然存在且可读。', {
      cause: error,
    })
  }
}

async function assertSafeAssetDirectory(
  documentPath: string,
  assetDirectory: string,
): Promise<void> {
  const assetStats = await lstat(assetDirectory)
  if (!assetStats.isDirectory() || assetStats.isSymbolicLink()) {
    throw new ImageAssetError('invalid-path', '图片资源目录不是安全的普通目录。')
  }

  const [realDocumentDirectory, realAssetDirectory] = await Promise.all([
    realpath(dirname(documentPath)),
    realpath(assetDirectory),
  ])
  const realRelativePath = relative(realDocumentDirectory, realAssetDirectory)
  if (!realRelativePath || isOutside(realRelativePath, pathApiFor(realDocumentDirectory))) {
    throw new ImageAssetError('invalid-path', '图片资源目录超出了当前文档目录。')
  }
}

export async function writeImageAsset(
  documentPath: string,
  suggestedName: string | undefined,
  image: PreparedImage,
  now = new Date(),
): Promise<WrittenImageAsset> {
  try {
    const documentStats = await stat(documentPath)
    if (!documentStats.isFile()) {
      throw new ImageAssetError('image-not-found', '当前 Markdown 文档已被移动或删除。')
    }

    const assetDirectory = getImageAssetDirectoryPath(documentPath)
    await mkdir(assetDirectory, { recursive: true })
    await assertSafeAssetDirectory(documentPath, assetDirectory)

    const safeFileName = sanitizeImageFileName(suggestedName, image.extension, now)
    for (let collisionIndex = 0; collisionIndex < 10_000; collisionIndex += 1) {
      const candidateName = withImageFilenameSuffix(safeFileName, collisionIndex)
      const candidatePath = join(assetDirectory, candidateName)
      const candidateRelativePath = relative(assetDirectory, candidatePath)
      if (!candidateRelativePath || isOutside(candidateRelativePath, pathApiFor(assetDirectory))) {
        throw new ImageAssetError('invalid-path', '图片目标路径超出了资源目录。')
      }

      let candidateHandle
      try {
        candidateHandle = await open(candidatePath, 'wx')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }

      try {
        await candidateHandle.writeFile(image.bytes)
      } catch (error) {
        await candidateHandle.close().catch(() => undefined)
        await rm(candidatePath, { force: true }).catch(() => undefined)
        throw error
      }
      await candidateHandle.close()
      return {
        absolutePath: candidatePath,
        relativePath: toMarkdownRelativePath(documentPath, candidatePath),
      }
    }

    throw new ImageAssetError('write-failed', '无法为图片生成不重复的文件名。')
  } catch (error) {
    if (error instanceof ImageAssetError) throw error
    throw new ImageAssetError('write-failed', '保存图片失败，请确认目标目录可写且空间充足。', {
      cause: error,
    })
  }
}

export async function readLocalMarkdownImage(
  documentPath: string,
  source: string,
): Promise<PreparedImage> {
  const imagePath = resolveMarkdownImagePath(documentPath, source)
  const expectedExtension = getSupportedImageExtension(imagePath)
  if (!expectedExtension) {
    throw new ImageAssetError('unsupported-image', '仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片。')
  }

  try {
    const imageStats = await lstat(imagePath)
    if (!imageStats.isFile() || imageStats.isSymbolicLink()) {
      throw new ImageAssetError('invalid-path', '图片路径不是安全的普通文件。')
    }
    if (imageStats.size > MAX_IMAGE_BYTES) {
      throw new ImageAssetError('image-too-large', '图片不能超过 25 MB。')
    }

    const [realDocumentDirectory, realImagePath] = await Promise.all([
      realpath(dirname(documentPath)),
      realpath(imagePath),
    ])
    const imageRelativePath = relative(realDocumentDirectory, realImagePath)
    if (!imageRelativePath || isOutside(imageRelativePath, pathApiFor(realDocumentDirectory))) {
      throw new ImageAssetError('invalid-path', '图片路径超出了当前文档目录。')
    }

    return prepareImageBytes(await readFile(realImagePath), expectedExtension)
  } catch (error) {
    if (error instanceof ImageAssetError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new ImageAssetError('image-not-found', '图片不存在，文档或资源文件可能已被移动。', {
        cause: error,
      })
    }
    throw new ImageAssetError('read-failed', '读取图片失败，请确认文件存在且可读。', {
      cause: error,
    })
  }
}
