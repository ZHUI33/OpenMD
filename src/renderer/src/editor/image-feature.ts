import type { Ctx } from '@milkdown/kit/ctx'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseMirrorNode, Schema } from '@milkdown/kit/prose/model'
import { NodeSelection, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { Decoration } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'

import type { ImagesApi, SaveImageResult } from '../../../shared/desktop-api.types'

export const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const

const supportedImageMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

const blockedProtocolPattern = /^[a-z][a-z\d+.-]*:/i
const safeResolvedDataUrlPattern =
  /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z\d+/=\s]+$/i

/** Renderer-facing shape of the context-isolated image preload API. */
export type RendererImagesApi = ImagesApi

export interface OpenMdImageFeatureOptions {
  imagesApi: RendererImagesApi
  getDocumentPath: () => string | undefined
  onEnsureDocumentSaved: () => Promise<string | undefined>
}

export type ImageDisplaySize = 'small' | 'medium' | 'large' | 'original'

interface ResolvedImage {
  url: string
  pathHint: string
}

function extensionFromName(name: string): string {
  const withoutQuery = name.split(/[?#]/, 1)[0] ?? ''
  const match = /\.([^.\\/]+)$/.exec(withoutQuery)
  return match?.[1]?.toLowerCase() ?? ''
}

export function isSupportedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (supportedImageMimeTypes.has(file.type.toLowerCase())) return true
  return SUPPORTED_IMAGE_EXTENSIONS.includes(
    extensionFromName(file.name) as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number],
  )
}

export function isSafeRemoteImageSource(source: string): boolean {
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isSafeResolvedImageUrl(url: string): boolean {
  return isSafeRemoteImageSource(url) || safeResolvedDataUrlPattern.test(url)
}

export function imageAltFromPath(source: string): string {
  const normalized = source.replace(/\\/g, '/')
  const lastSegment = normalized.slice(normalized.lastIndexOf('/') + 1)
  let decoded = lastSegment
  try {
    decoded = decodeURIComponent(lastSegment)
  } catch {
    // A malformed URI escape is still safe to display as plain text.
  }
  return decoded.replace(/\.[^.]+$/, '') || '图片'
}

function humanReadablePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function extractRemoteImageFromClipboard(data: DataTransfer | null): {
  src: string
  alt: string
} | null {
  const html = data?.getData('text/html')
  if (!html) return null

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const images = parsed.querySelectorAll('img[src]')
  // Do not discard surrounding rich text when pasting a whole HTML fragment.
  if (images.length !== 1 || parsed.body.textContent?.trim()) return null
  const image = images.item(0)
  const src = image?.getAttribute('src')?.trim() ?? ''
  if (!isSafeRemoteImageSource(src)) return null
  return { src, alt: image?.getAttribute('alt')?.trim() || imageAltFromPath(src) }
}

function isLocalImageSource(source: string): boolean {
  if (
    !source ||
    source.includes('\u0000') ||
    source.startsWith('/') ||
    source.startsWith('\\') ||
    blockedProtocolPattern.test(source)
  ) {
    return false
  }

  const pathOnly = source.split(/[?#]/, 1)[0] ?? source
  let decoded = pathOnly
  try {
    decoded = decodeURIComponent(pathOnly)
  } catch {
    // The main process performs the final canonical-path validation.
  }
  return !decoded.replace(/\\/g, '/').split('/').includes('..')
}

function imageNode(
  schema: Schema,
  source: string,
  alt = imageAltFromPath(source),
): ProseMirrorNode {
  const type = schema.nodes.image
  if (!type) throw new Error('The Milkdown image node is not available.')
  return type.create({ src: source, alt, title: '' })
}

function insertImageAtSelection(view: EditorView, source: string, alt?: string): void {
  const node = imageNode(view.state.schema, source, alt)
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView())
  view.focus()
}

async function writeClipboardText(ownerDocument: Document, value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back to the legacy copy command when clipboard permission is denied.
    }
  }

  const textarea = ownerDocument.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  ownerDocument.body.appendChild(textarea)
  textarea.select()
  const legacyDocument = ownerDocument as Document & {
    execCommand?: (command: string) => boolean
  }
  const copied = legacyDocument.execCommand?.('copy') ?? false
  textarea.remove()
  if (!copied) throw new Error('Clipboard access is unavailable.')
}

class OpenMdImageController {
  private view?: EditorView
  private ensureDocumentPromise?: Promise<string | undefined>
  private nextUploadOrigin: 'paste' | 'drop' = 'drop'
  private documentPathSnapshot?: string
  private documentEpoch = 0
  private readonly resolved = new Map<string, ResolvedImage>()
  private readonly displaySizes = new Map<string, ImageDisplaySize>()
  private readonly refreshListeners = new Set<() => void>()

  constructor(private readonly options: OpenMdImageFeatureOptions) {
    this.documentPathSnapshot = options.getDocumentPath()
  }

  attach(view: EditorView): void {
    this.view = view
  }

  detach(view: EditorView): void {
    if (this.view === view) this.view = undefined
  }

  prepareUpload(origin: 'paste' | 'drop'): void {
    this.nextUploadOrigin = origin
  }

  setDocumentPath(documentPath: string | undefined): void {
    if (documentPath === this.documentPathSnapshot) return
    this.documentPathSnapshot = documentPath
    this.documentEpoch += 1
    this.resolved.clear()
    for (const refresh of this.refreshListeners) refresh()
  }

  onRefresh(refresh: () => void): () => void {
    this.refreshListeners.add(refresh)
    return () => this.refreshListeners.delete(refresh)
  }

  private async documentPath(): Promise<string | undefined> {
    const current = this.options.getDocumentPath() || this.documentPathSnapshot
    if (current) {
      this.documentPathSnapshot = current
      return current
    }

    if (!this.ensureDocumentPromise) {
      this.ensureDocumentPromise = this.options
        .onEnsureDocumentSaved()
        .then((savedPath) => {
          const resolvedPath = savedPath || this.options.getDocumentPath()
          if (resolvedPath) this.documentPathSnapshot = resolvedPath
          return resolvedPath
        })
        .finally(() => {
          this.ensureDocumentPromise = undefined
        })
    }
    return this.ensureDocumentPromise
  }

  async saveFiles(files: FileList, schema: Schema): Promise<ProseMirrorNode[]> {
    if (!this.view?.editable) return []
    const uploadOrigin = this.nextUploadOrigin
    this.nextUploadOrigin = 'drop'
    const supported = Array.from(files).filter(isSupportedImageFile)
    if (supported.length === 0) {
      this.notify('仅支持 PNG、JPG、GIF、WebP 和 SVG 图片。', 'error')
      return []
    }

    const documentPath = await this.documentPath()
    // A cancelled Save dialog must end the operation before any image IPC call.
    if (!documentPath) return []
    const documentEpoch = this.documentEpoch

    const nodes: ProseMirrorNode[] = []
    for (const file of supported) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (!this.isCurrentDocument(documentPath, documentEpoch)) {
          this.notify('文档已切换，已取消图片插入。')
          return []
        }
        const result = await this.options.imagesApi.saveImage({
          documentPath,
          bytes,
          // Clipboard screenshots usually report the meaningless `image.png`.
          // Omitting the suggestion lets the main process create its timestamp
          // name, while file-manager drops retain a useful original filename.
          suggestedName: uploadOrigin === 'paste' ? undefined : file.name || undefined,
        })
        if (!this.isCurrentDocument(documentPath, documentEpoch)) {
          this.notify('文档已切换，已取消图片插入。')
          return []
        }
        if (result.canceled) continue
        if (result.error || !result.relativePath) {
          this.notify(result.error?.message || `无法保存图片“${file.name}”。`, 'error')
          continue
        }

        this.rememberSavedImage(documentPath, result)
        nodes.push(imageNode(schema, result.relativePath, imageAltFromPath(file.name)))
      } catch (error) {
        this.notify(
          error instanceof Error ? error.message : `无法保存图片“${file.name}”。`,
          'error',
        )
      }
    }
    return nodes
  }

  async selectAndInsert(): Promise<void> {
    const view = this.view
    if (!view?.editable) return

    const documentPath = await this.documentPath()
    if (!documentPath) return
    const documentEpoch = this.documentEpoch

    try {
      const result = await this.options.imagesApi.selectImage({ documentPath })
      if (!this.isCurrentDocument(documentPath, documentEpoch)) {
        this.notify('文档已切换，已取消图片插入。')
        return
      }
      if (result.canceled) return
      if (result.error || !result.relativePath) {
        this.notify(result.error?.message || '无法插入所选图片。', 'error')
        return
      }

      this.rememberSavedImage(documentPath, result)
      insertImageAtSelection(view, result.relativePath)
    } catch (error) {
      this.notify(error instanceof Error ? error.message : '无法插入所选图片。', 'error')
    }
  }

  async resolve(source: string): Promise<ResolvedImage> {
    const normalized = source.trim()
    if (isSafeRemoteImageSource(normalized)) return { url: normalized, pathHint: normalized }
    if (!isLocalImageSource(normalized)) throw new Error('已阻止不安全的图片地址。')

    const documentPath = this.options.getDocumentPath() || this.documentPathSnapshot
    if (!documentPath) throw new Error('请先保存 Markdown 文档，再加载本地图片。')

    const key = this.cacheKey(documentPath, normalized)
    const cached = this.resolved.get(key)
    if (cached) return cached

    const result = await this.options.imagesApi.resolveImage({ documentPath, source: normalized })
    if (!result.ok || !result.url) {
      throw new Error(result.error?.message || '图片文件不存在或已随文档移动。')
    }
    if (!isSafeResolvedImageUrl(result.url)) throw new Error('图片解析器返回了不安全的地址。')

    const resolved = { url: result.url, pathHint: result.pathHint || normalized }
    this.resolved.set(key, resolved)
    return resolved
  }

  getDisplaySize(source: string): ImageDisplaySize {
    return this.displaySizes.get(source) ?? 'large'
  }

  setDisplaySize(source: string, size: ImageDisplaySize): void {
    this.displaySizes.set(source, size)
  }

  private rememberSavedImage(documentPath: string, result: SaveImageResult): void {
    if (!result.relativePath || !result.displayUrl || !isSafeResolvedImageUrl(result.displayUrl))
      return
    this.resolved.set(this.cacheKey(documentPath, result.relativePath), {
      url: result.displayUrl,
      pathHint: result.relativePath,
    })
  }

  private cacheKey(documentPath: string, source: string): string {
    return `${documentPath}\u0000${source}`
  }

  private isCurrentDocument(documentPath: string, documentEpoch: number): boolean {
    return (
      documentEpoch === this.documentEpoch &&
      (this.options.getDocumentPath() || this.documentPathSnapshot) === documentPath
    )
  }

  notify(message: string, kind: 'info' | 'error' = 'info'): void {
    const ownerDocument = this.view?.dom.ownerDocument ?? document
    const toast = ownerDocument.createElement('div')
    toast.className = 'openmd-image-toast'
    toast.dataset.kind = kind
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    toast.textContent = message
    ownerDocument.body.appendChild(toast)
    ownerDocument.defaultView?.setTimeout(() => toast.remove(), 3600)
  }
}

class OpenMdImageNodeView implements NodeView {
  readonly dom: HTMLElement
  private readonly image: HTMLImageElement
  private readonly placeholder: HTMLSpanElement
  private readonly status: HTMLSpanElement
  private readonly path: HTMLSpanElement
  private readonly toolbar: HTMLSpanElement
  private readonly altInput: HTMLInputElement
  private readonly unregisterRefresh: () => void
  private node: ProseMirrorNode
  private revision = 0
  private destroyed = false
  private composingAlt = false

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly controller: OpenMdImageController,
  ) {
    this.node = node
    const ownerDocument = view.dom.ownerDocument
    this.dom = ownerDocument.createElement('span')
    this.dom.className = 'openmd-image-node'
    this.dom.contentEditable = 'false'
    this.dom.dataset.state = 'loading'
    this.dom.dataset.size = controller.getDisplaySize(String(node.attrs.src))

    const visual = ownerDocument.createElement('span')
    visual.className = 'openmd-image-visual'
    this.image = ownerDocument.createElement('img')
    this.image.className = 'openmd-image'
    this.image.decoding = 'async'
    this.image.referrerPolicy = 'no-referrer'
    this.image.draggable = true
    this.placeholder = ownerDocument.createElement('span')
    this.placeholder.className = 'openmd-image-placeholder'
    this.status = ownerDocument.createElement('span')
    this.status.className = 'openmd-image-status'
    visual.append(this.image, this.placeholder, this.status)

    this.path = ownerDocument.createElement('span')
    this.path.className = 'openmd-image-path'

    this.toolbar = ownerDocument.createElement('span')
    this.toolbar.className = 'openmd-image-toolbar'
    this.toolbar.setAttribute('role', 'toolbar')
    this.toolbar.setAttribute('aria-label', '图片操作')

    const altLabel = ownerDocument.createElement('label')
    altLabel.className = 'openmd-image-alt-field'
    const altCaption = ownerDocument.createElement('span')
    altCaption.textContent = '说明'
    this.altInput = ownerDocument.createElement('input')
    this.altInput.type = 'text'
    this.altInput.value = String(node.attrs.alt ?? '')
    this.altInput.placeholder = '图片说明（alt）'
    this.altInput.setAttribute('aria-label', '图片说明')
    altLabel.append(altCaption, this.altInput)
    this.toolbar.appendChild(altLabel)

    const sizes: ReadonlyArray<[ImageDisplaySize, string]> = [
      ['small', '小'],
      ['medium', '中'],
      ['large', '大'],
      ['original', '原始'],
    ]
    for (const [size, label] of sizes) {
      const button = this.button(label, `显示为${label}尺寸`)
      button.dataset.size = size
      button.addEventListener('click', () => this.setSize(size))
      this.toolbar.appendChild(button)
    }

    const copy = this.button('复制路径', '复制图片 Markdown 路径')
    copy.addEventListener('click', () => void this.copyPath())
    const remove = this.button('删除', '删除图片节点')
    remove.dataset.danger = 'true'
    remove.addEventListener('click', () => this.deleteNode())
    this.toolbar.append(copy, remove)

    this.dom.append(visual, this.path, this.toolbar)
    this.dom.addEventListener('click', this.select)
    this.altInput.addEventListener('input', this.onAltInput)
    this.altInput.addEventListener('keydown', this.onAltKeyDown)
    this.altInput.addEventListener('compositionstart', this.onAltCompositionStart)
    this.altInput.addEventListener('compositionend', this.onAltCompositionEnd)
    this.unregisterRefresh = controller.onRefresh(() => this.render())
    this.render()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    const sourceChanged = node.attrs.src !== this.node.attrs.src
    this.node = node
    this.image.alt = String(node.attrs.alt ?? '')
    const nextAlt = String(node.attrs.alt ?? '')
    if (!this.composingAlt && this.altInput.value !== nextAlt) this.altInput.value = nextAlt
    if (sourceChanged) {
      this.dom.dataset.size = this.controller.getDisplaySize(String(node.attrs.src))
      this.render()
    }
    return true
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode')
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode')
  }

  stopEvent(event: Event): boolean {
    return this.toolbar.contains(event.target as Node)
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.destroyed = true
    this.revision += 1
    this.image.onload = null
    this.image.onerror = null
    this.dom.removeEventListener('click', this.select)
    this.altInput.removeEventListener('input', this.onAltInput)
    this.altInput.removeEventListener('keydown', this.onAltKeyDown)
    this.altInput.removeEventListener('compositionstart', this.onAltCompositionStart)
    this.altInput.removeEventListener('compositionend', this.onAltCompositionEnd)
    this.unregisterRefresh()
  }

  private button(label: string, ariaLabel: string): HTMLButtonElement {
    const button = this.view.dom.ownerDocument.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.setAttribute('aria-label', ariaLabel)
    button.addEventListener('pointerdown', (event) => event.preventDefault())
    return button
  }

  private render(): void {
    const source = String(this.node.attrs.src ?? '').trim()
    const revision = ++this.revision
    this.dom.dataset.state = 'loading'
    this.placeholder.textContent = '正在加载图片…'
    this.status.textContent = ''
    this.path.textContent = source
    this.path.title = source
    this.image.alt = String(this.node.attrs.alt ?? '')
    this.image.removeAttribute('src')

    void this.controller
      .resolve(source)
      .then(({ url, pathHint }) => {
        if (this.destroyed || revision !== this.revision) return
        this.path.textContent = humanReadablePath(pathHint)
        this.path.title = humanReadablePath(pathHint)
        this.image.onload = () => this.markReady(revision)
        this.image.onerror = () => {
          if (revision !== this.revision) return
          this.fail('图片加载失败，请检查路径或网络连接。')
        }
        this.image.src = url
        if (this.image.complete && this.image.naturalWidth > 0) this.markReady(revision)
      })
      .catch((error: unknown) => {
        if (this.destroyed || revision !== this.revision) return
        this.fail(error instanceof Error ? error.message : '图片加载失败。')
      })
  }

  private fail(message: string): void {
    this.dom.dataset.state = 'error'
    this.placeholder.textContent = '图片加载失败'
    this.status.textContent = message
  }

  private markReady(revision: number): void {
    if (revision !== this.revision) return
    this.dom.dataset.state = 'ready'
    this.placeholder.textContent = ''
    this.status.textContent = ''
  }

  private select = (event: MouseEvent): void => {
    if (this.toolbar.contains(event.target as Node)) return
    const position = this.getPos()
    if (position === undefined) return
    this.view.dispatch(
      this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, position)),
    )
  }

  private updateAlt = (): void => {
    const position = this.getPos()
    if (position === undefined) return
    const alt = this.altInput.value
    const attrs = { ...this.node.attrs, alt }
    this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, attrs))
  }

  private onAltInput = (): void => {
    if (!this.composingAlt) this.updateAlt()
  }

  private onAltCompositionStart = (): void => {
    this.composingAlt = true
  }

  private onAltCompositionEnd = (): void => {
    this.composingAlt = false
    this.updateAlt()
  }

  private onAltKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    this.updateAlt()
    this.view.focus()
  }

  private setSize(size: ImageDisplaySize): void {
    const source = String(this.node.attrs.src ?? '')
    this.controller.setDisplaySize(source, size)
    this.dom.dataset.size = size
  }

  private async copyPath(): Promise<void> {
    const source = String(this.node.attrs.src ?? '')
    try {
      await writeClipboardText(this.view.dom.ownerDocument, source)
      this.controller.notify('已复制图片路径。')
    } catch {
      this.controller.notify('无法访问剪贴板。', 'error')
    }
  }

  private deleteNode(): void {
    const position = this.getPos()
    if (position === undefined) return
    this.view.dispatch(this.view.state.tr.delete(position, position + this.node.nodeSize))
    this.view.focus()
  }
}

const remoteClipboardImageKey = new PluginKey('openmd-remote-clipboard-image')

/**
 * CommonMark image NodeView plus safe image ingestion. Milkdown's stock upload
 * plugin remains installed by Crepe, but its blob/data URL uploader is replaced
 * here so every pasted or dropped File is persisted by the preload API first.
 */
export function createOpenMdImageFeature(options: OpenMdImageFeatureOptions) {
  const controller = new OpenMdImageController(options)

  const imageView = $view(imageSchema.node, () => (node, view, getPos) => {
    return new OpenMdImageNodeView(node, view, getPos, controller)
  })

  const remoteClipboardImagePlugin = $prose(
    () =>
      new Plugin({
        key: remoteClipboardImageKey,
        props: {
          handlePaste: (view, event) => {
            if (event.clipboardData?.files.length) return false
            const remote = extractRemoteImageFromClipboard(event.clipboardData)
            if (!remote) return false
            event.preventDefault()
            insertImageAtSelection(view, remote.src, remote.alt)
            return true
          },
          handleDOMEvents: {
            dragover: (_view, event) => {
              const drag = event as DragEvent
              const hasImage = Array.from(drag.dataTransfer?.files ?? []).some(isSupportedImageFile)
              if (!hasImage) return false
              drag.preventDefault()
              if (drag.dataTransfer) drag.dataTransfer.dropEffect = 'copy'
              return true
            },
          },
        },
        view: (view) => {
          controller.attach(view)
          return { destroy: () => controller.detach(view) }
        },
      }),
  )

  return {
    plugins: [imageView, remoteClipboardImagePlugin],
    configureUpload: (ctx: Ctx): void => {
      ctx.update(uploadConfig.key, (current) => ({
        ...current,
        enableHtmlFileUploader: true,
        uploader: (files, schema) => controller.saveFiles(files, schema),
        getInsertPos: (event, uploadCtx, defaultPosition) => {
          controller.prepareUpload(event.type === 'paste' ? 'paste' : 'drop')
          return current.getInsertPos?.(event, uploadCtx, defaultPosition) ?? defaultPosition
        },
        uploadWidgetFactory: (position, spec) => {
          const loading = document.createElement('span')
          loading.className = 'openmd-image-uploading'
          loading.textContent = '正在保存图片…'
          return Decoration.widget(position, loading, spec)
        },
      }))
    },
    insertFromPicker: () => controller.selectAndInsert(),
    setDocumentPath: (documentPath: string | undefined) => controller.setDocumentPath(documentPath),
  }
}
