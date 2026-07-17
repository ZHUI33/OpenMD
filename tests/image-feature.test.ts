// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { OpenMdEditorAdapter } from '../src/renderer/src/editor/editor-adapter'
import {
  isSafeRemoteImageSource,
  isSafeResolvedImageUrl,
} from '../src/renderer/src/editor/image-feature'
import type { ImagesApi } from '../src/shared/desktop-api.types'

class ImmediateIntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe = (target: Element): void => {
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: performance.now(),
        },
      ],
      this as unknown as IntersectionObserver,
    )
  }

  disconnect = (): void => undefined
  takeRecords = (): IntersectionObserverEntry[] => []
  unobserve = (): void => undefined
}

class NoopResizeObserver {
  disconnect = (): void => undefined
  observe = (): void => undefined
  unobserve = (): void => undefined
}

class OpenMdClipboardEvent extends Event {
  clipboardData: DataTransfer | null = null
}

class OpenMdDragEvent extends Event {}

const adapters: OpenMdEditorAdapter[] = []

beforeAll(() => {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: ImmediateIntersectionObserver,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: NoopResizeObserver,
  })
  Object.defineProperty(globalThis, 'ClipboardEvent', {
    configurable: true,
    value: OpenMdClipboardEvent,
  })
  Object.defineProperty(window, 'ClipboardEvent', {
    configurable: true,
    value: OpenMdClipboardEvent,
  })
  Object.defineProperty(globalThis, 'DragEvent', {
    configurable: true,
    value: OpenMdDragEvent,
  })
  Object.defineProperty(window, 'DragEvent', {
    configurable: true,
    value: OpenMdDragEvent,
  })
  if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [],
    })
  }
  if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(),
    })
  }
})

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.destroy()))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function createImagesApi(overrides: Partial<ImagesApi> = {}): ImagesApi {
  return {
    saveImage: vi.fn(async () => ({ canceled: true })),
    selectImage: vi.fn(async () => ({ canceled: true })),
    resolveImage: vi.fn(async ({ source }) => ({
      ok: true,
      url: 'data:image/png;base64,iVBORw0KGgo=',
      pathHint: source,
    })),
    ...overrides,
  }
}

async function createAdapter(
  markdown: string,
  imagesApi = createImagesApi(),
  extra: Partial<ConstructorParameters<typeof OpenMdEditorAdapter>[0]> = {},
): Promise<{ adapter: OpenMdEditorAdapter; root: HTMLDivElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const adapter = new OpenMdEditorAdapter({
    root,
    initialMarkdown: markdown,
    readOnly: false,
    onChange: () => undefined,
    imagesApi,
    getDocumentPath: () => 'C:\\notes\\article.md',
    onEnsureDocumentSaved: async () => 'C:\\notes\\article.md',
    ...extra,
  })
  adapters.push(adapter)
  await adapter.create()
  return { adapter, root }
}

describe('phase 5 image feature', () => {
  it('keeps standard Markdown image syntax and renders a remote SVG as an img', async () => {
    const source = '![架构图](https://example.com/architecture.svg)'
    const { adapter, root } = await createAdapter(source)

    await vi.waitFor(() => {
      expect(root.querySelector<HTMLImageElement>('.openmd-image')?.src).toBe(
        'https://example.com/architecture.svg',
      )
    })
    expect(adapter.getMarkdown()).toContain(source)
    expect(root.querySelector('script, iframe, object, embed')).toBeNull()
  })

  it('allows only HTTP(S) remote sources and image-only resolved data URLs', () => {
    expect(isSafeRemoteImageSource('https://example.com/image.png')).toBe(true)
    expect(isSafeRemoteImageSource('http://example.com/image.webp')).toBe(true)
    expect(isSafeRemoteImageSource('javascript:alert(1)')).toBe(false)
    expect(isSafeRemoteImageSource('file:///tmp/image.png')).toBe(false)
    expect(isSafeResolvedImageUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(true)
    expect(isSafeResolvedImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
  })

  it('resolves a relative path through preload and exposes loading/path state', async () => {
    const resolveImage = vi.fn<ImagesApi['resolveImage']>(async ({ source }) => ({
      ok: true,
      url: 'data:image/png;base64,iVBORw0KGgo=',
      pathHint: `C:\\notes\\${source.replaceAll('/', '\\')}`,
    }))
    const { root } = await createAdapter(
      '![示例](article.assets/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png)',
      createImagesApi({ resolveImage }),
    )

    expect(root.querySelector('.openmd-image-node')?.getAttribute('data-state')).toBe('loading')
    await vi.waitFor(() => expect(resolveImage).toHaveBeenCalledOnce())
    expect(resolveImage).toHaveBeenCalledWith({
      documentPath: 'C:\\notes\\article.md',
      source: 'article.assets/%E6%9E%B6%E6%9E%84%20%E5%9B%BE.png',
    })
    expect(root.querySelector('.openmd-image-path')?.textContent).toContain('架构 图.png')
  })

  it('re-resolves existing image nodes after an untitled document receives a path', async () => {
    const documentState: { path?: string } = {}
    const resolveImage = vi.fn<ImagesApi['resolveImage']>(async () => ({
      ok: true,
      url: 'data:image/png;base64,iVBORw0KGgo=',
    }))
    const { adapter, root } = await createAdapter(
      '![示例](article.assets/image.png)',
      createImagesApi({ resolveImage }),
      { getDocumentPath: () => documentState.path },
    )
    await vi.waitFor(() => {
      expect(root.querySelector('.openmd-image-node')?.getAttribute('data-state')).toBe('error')
    })
    expect(resolveImage).not.toHaveBeenCalled()

    documentState.path = 'D:\\文章\\article.md'
    adapter.setDocumentPath(documentState.path)

    await vi.waitFor(() => {
      expect(resolveImage).toHaveBeenCalledWith({
        documentPath: 'D:\\文章\\article.md',
        source: 'article.assets/image.png',
      })
    })
  })

  it('inserts a file-picker result as a relative CommonMark image', async () => {
    const selectImage = vi.fn<ImagesApi['selectImage']>(async () => ({
      canceled: false,
      relativePath: 'article.assets/architecture.png',
      displayUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }))
    const { adapter } = await createAdapter('', createImagesApi({ selectImage }))

    await adapter.insertImageFromPicker()

    expect(selectImage).toHaveBeenCalledWith({ documentPath: 'C:\\notes\\article.md' })
    expect(adapter.getMarkdown()).toContain('![architecture](article.assets/architecture.png)')
  })

  it('updates alt text, keeps display size out of Markdown, and deletes only the node', async () => {
    const source = 'https://example.com/photo.png'
    const { adapter, root } = await createAdapter(`![旧说明](${source})`)
    const imageNode = root.querySelector<HTMLElement>('.openmd-image-node')
    imageNode?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const alt = root.querySelector<HTMLInputElement>('[aria-label="图片说明"]')
    if (alt) alt.value = '新说明'
    alt?.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLButtonElement>('[aria-label="显示为小尺寸"]')?.click()

    expect(imageNode?.dataset.size).toBe('small')
    expect(adapter.getMarkdown()).toContain(`![新说明](${source})`)
    expect(adapter.getMarkdown()).not.toMatch(/data-openmd|width=|style=/)

    root.querySelector<HTMLButtonElement>('[aria-label="删除图片节点"]')?.click()
    expect(adapter.getMarkdown()).not.toContain(source)
  })

  it('shows a clear failure state when a local image can no longer be resolved', async () => {
    const resolveImage = vi.fn<ImagesApi['resolveImage']>(async () => ({
      ok: false,
      error: { code: 'image-not-found', message: '图片不存在，文档或资源文件可能已被移动。' },
    }))
    const { root } = await createAdapter(
      '![丢失](article.assets/missing.png)',
      createImagesApi({ resolveImage }),
    )

    await vi.waitFor(() => {
      expect(root.querySelector('.openmd-image-node')?.getAttribute('data-state')).toBe('error')
    })
    expect(root.querySelector('.openmd-image-status')?.textContent).toContain('可能已被移动')
  })

  it('pastes screenshot bytes without preserving the generic clipboard filename', async () => {
    const saveImage = vi.fn<ImagesApi['saveImage']>(async () => ({
      canceled: false,
      relativePath: 'article.assets/image-20260717-092500.png',
      displayUrl: 'data:image/png;base64,iVBORw0KGgo=',
    }))
    const { adapter, root } = await createAdapter('', createImagesApi({ saveImage }))
    const screenshot = {
      name: 'image.png',
      type: 'image/png',
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as File
    const files = {
      0: screenshot,
      length: 1,
      item: (index: number) => (index === 0 ? screenshot : null),
    } as unknown as FileList
    const event = new OpenMdClipboardEvent('paste', { bubbles: true, cancelable: true })
    event.clipboardData = {
      files,
      getData: () => '',
    } as unknown as DataTransfer

    root.querySelector('.ProseMirror')?.dispatchEvent(event)

    await vi.waitFor(() => expect(saveImage).toHaveBeenCalledOnce())
    expect(saveImage).toHaveBeenCalledWith({
      documentPath: 'C:\\notes\\article.md',
      bytes: new Uint8Array([137, 80, 78, 71]),
      suggestedName: undefined,
    })
    await vi.waitFor(() => {
      expect(adapter.getMarkdown()).toContain('article.assets/image-20260717-092500.png')
    })
  })

  it('does not insert a completed upload into a document opened during the save', async () => {
    const documentState = { path: 'C:\\notes\\first.md' }
    let finishSave: ((result: Awaited<ReturnType<ImagesApi['saveImage']>>) => void) | undefined
    const saveImage = vi.fn<ImagesApi['saveImage']>(
      () =>
        new Promise((resolve) => {
          finishSave = resolve
        }),
    )
    const { adapter, root } = await createAdapter('', createImagesApi({ saveImage }), {
      getDocumentPath: () => documentState.path,
    })
    const imageFile = {
      name: 'diagram.png',
      type: 'image/png',
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as File
    const files = {
      0: imageFile,
      length: 1,
      item: () => imageFile,
    } as unknown as FileList
    const event = new OpenMdClipboardEvent('paste', { bubbles: true, cancelable: true })
    event.clipboardData = { files, getData: () => '' } as unknown as DataTransfer
    root.querySelector('.ProseMirror')?.dispatchEvent(event)
    await vi.waitFor(() => expect(saveImage).toHaveBeenCalledOnce())

    documentState.path = 'C:\\notes\\second.md'
    adapter.setDocumentPath(documentState.path)
    finishSave?.({
      canceled: false,
      relativePath: 'first.assets/diagram.png',
      displayUrl: 'data:image/png;base64,iVBORw0KGgo=',
    })

    await vi.waitFor(() => {
      expect(document.body.querySelector('.openmd-image-toast')?.textContent).toContain(
        '文档已切换',
      )
    })
    expect(adapter.getMarkdown()).not.toContain('first.assets/diagram.png')
  })
})
