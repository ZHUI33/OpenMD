import { basename, extname } from 'node:path'

import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'

import type {
  ImageOperationError,
  ResolveImageRequest,
  ResolveImageResult,
  SaveImageRequest,
  SaveImageResult,
  SelectImageRequest,
} from '../shared/desktop-api.types'
import type { DocumentService } from './document-service'
import {
  getSupportedImageExtension,
  imageToDataUrl,
  ImageAssetError,
  parseRemoteImageUrl,
  prepareImageBytes,
  readLocalMarkdownImage,
  readSupportedImageFile,
  writeImageAsset,
} from './image-assets'
import type { ImageAssetLocationOptions } from './image-assets'
import { areSameFilePaths } from './recent-files'

const IMAGE_FILTERS = [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }]
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i

function asOperationError(error: unknown, fallback: ImageOperationError): ImageOperationError {
  if (error instanceof ImageAssetError) return { code: error.code, message: error.message }
  return fallback
}

export class ImageService {
  constructor(
    private readonly documents: Pick<DocumentService, 'getAuthorizedDocumentPath'>,
    private readonly now: () => Date = () => new Date(),
    private readonly getLocationOptions: (
      parentWindow: BrowserWindow,
      documentPath: string,
    ) => Promise<ImageAssetLocationOptions> | ImageAssetLocationOptions = () => ({}),
  ) {}

  async saveImage(
    parentWindow: BrowserWindow,
    request: SaveImageRequest,
  ): Promise<SaveImageResult> {
    try {
      const documentPath = this.getAuthorizedDocumentPath(parentWindow, request.documentPath)
      if (!request.bytes) {
        throw new ImageAssetError('invalid-request', '保存图片时必须提供图片二进制数据。')
      }

      const suggestedName = request.suggestedName
      if (suggestedName && extname(suggestedName) && !getSupportedImageExtension(suggestedName)) {
        throw new ImageAssetError('unsupported-image', '仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片。')
      }
      const image = prepareImageBytes(
        request.bytes,
        getSupportedImageExtension(suggestedName ?? ''),
      )

      const locationOptions = await this.getLocationOptions(parentWindow, documentPath)
      const writtenImage = await writeImageAsset(
        documentPath,
        suggestedName,
        image,
        this.now(),
        locationOptions,
      )
      return {
        canceled: false,
        relativePath: writtenImage.relativePath,
        displayUrl: imageToDataUrl(image),
      }
    } catch (error) {
      this.logError('save', error)
      return {
        canceled: false,
        error: asOperationError(error, {
          code: 'write-failed',
          message: '保存图片失败，请稍后重试。',
        }),
      }
    }
  }

  async selectImage(
    parentWindow: BrowserWindow,
    request: SelectImageRequest,
  ): Promise<SaveImageResult> {
    try {
      const documentPath = this.getAuthorizedDocumentPath(parentWindow, request.documentPath)
      const selection = await dialog.showOpenDialog(parentWindow, {
        title: '插入图片',
        properties: ['openFile'],
        filters: IMAGE_FILTERS,
      })
      if (selection.canceled || selection.filePaths.length === 0) return { canceled: true }

      const sourcePath = selection.filePaths[0]
      const image = await readSupportedImageFile(sourcePath)
      const locationOptions = await this.getLocationOptions(parentWindow, documentPath)
      const writtenImage = await writeImageAsset(
        documentPath,
        basename(sourcePath),
        image,
        this.now(),
        locationOptions,
      )
      return {
        canceled: false,
        relativePath: writtenImage.relativePath,
        displayUrl: imageToDataUrl(image),
      }
    } catch (error) {
      this.logError('select', error)
      return {
        canceled: false,
        error: asOperationError(error, {
          code: 'write-failed',
          message: '插入图片失败，请稍后重试。',
        }),
      }
    }
  }

  async resolveImage(
    parentWindow: BrowserWindow,
    request: ResolveImageRequest,
  ): Promise<ResolveImageResult> {
    try {
      const documentPath = this.getAuthorizedDocumentPath(parentWindow, request.documentPath)
      const source = request.source.trim()
      const remoteUrl = parseRemoteImageUrl(source)
      if (remoteUrl) return { ok: true, url: remoteUrl, pathHint: source }
      if (URL_SCHEME.test(source) || source.startsWith('//')) {
        throw new ImageAssetError('invalid-path', '远程图片只允许使用 HTTP 或 HTTPS 地址。')
      }

      const locationOptions = await this.getLocationOptions(parentWindow, documentPath)
      const readLocationOptions = locationOptions.workspaceRoot
        ? { ...locationOptions, rule: 'workspace-assets' as const }
        : locationOptions
      const image = await readLocalMarkdownImage(documentPath, source, readLocationOptions)
      return { ok: true, url: imageToDataUrl(image), pathHint: source }
    } catch (error) {
      this.logError('resolve', error)
      return {
        ok: false,
        pathHint: request.source,
        error: asOperationError(error, {
          code: 'read-failed',
          message: '加载图片失败，请确认路径或地址有效。',
        }),
      }
    }
  }

  private getAuthorizedDocumentPath(
    parentWindow: BrowserWindow,
    requestedDocumentPath: string,
  ): string {
    if (!requestedDocumentPath) {
      throw new ImageAssetError('document-not-saved', '请先保存 Markdown 文档，再插入图片。')
    }
    const authorizedPath = this.documents.getAuthorizedDocumentPath(
      parentWindow,
      requestedDocumentPath,
    )
    if (!authorizedPath || !areSameFilePaths(authorizedPath, requestedDocumentPath)) {
      throw new ImageAssetError('unauthorized-document', '图片操作未获当前文档授权。')
    }
    return authorizedPath
  }

  private logError(operation: 'save' | 'select' | 'resolve', error: unknown): void {
    if (!app.isPackaged) console.error(`Failed to ${operation} image:`, error)
  }
}
