// @vitest-environment jsdom

import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { OpenMdEditorAdapter } from '../src/renderer/src/editor/editor-adapter'

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

const fixtureDirectory = resolve('tests/fixtures/markdown-compatibility')
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
  if (!('getComputedTextLength' in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
      configurable: true,
      value(this: SVGElement) {
        return (this.textContent?.length ?? 0) * 8
      },
    })
  }
  if (!('getBBox' in SVGElement.prototype)) {
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value: () => ({ x: 0, y: 0, width: 80, height: 16 }),
    })
  }
})

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.destroy()))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

async function createAdapter(
  markdown: string,
  onChange: (markdown: string) => void = () => undefined,
): Promise<{ adapter: OpenMdEditorAdapter; root: HTMLDivElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const adapter = new OpenMdEditorAdapter({
    root,
    initialMarkdown: markdown,
    readOnly: false,
    onChange,
  })
  adapters.push(adapter)
  await adapter.create()
  return { adapter, root }
}

describe('Markdown compatibility corpus', () => {
  it('covers every compatibility category with real LF, CRLF, and mixed fixtures', async () => {
    const files = await readdir(fixtureDirectory)
    expect(files).toEqual(
      expect.arrayContaining([
        'front-matter.md',
        'gfm-table.md',
        'task-list.md',
        'footnotes.md',
        'reference-links.md',
        'autolinks.md',
        'alerts.md',
        'math.md',
        'mermaid.md',
        'fenced-code.md',
        'html-block.md',
        'escapes-unicode.md',
        'images-paths.md',
        'structures.md',
        'unsupported-raw.md',
        'line-endings-lf.md',
        'line-endings-crlf.md',
        'line-endings-mixed.md',
      ]),
    )

    const crlf = await readFile(resolve(fixtureDirectory, 'line-endings-crlf.md'), 'utf8')
    const mixed = await readFile(resolve(fixtureDirectory, 'line-endings-mixed.md'), 'utf8')
    expect(crlf).toMatch(/\r\n/u)
    expect(crlf).not.toMatch(/(?<!\r)\n/u)
    expect(mixed).toMatch(/\r\n/u)
    expect(mixed).toMatch(/(?<!\r)\n/u)
    expect(mixed).toMatch(/\r(?!\n)/u)
  })

  it('round-trips every fixture through an untouched visual document byte-for-byte', async () => {
    const fixtureNames = (await readdir(fixtureDirectory)).filter((name) => name.endsWith('.md'))

    for (const fixtureName of fixtureNames) {
      const markdown = await readFile(resolve(fixtureDirectory, fixtureName), 'utf8')
      const changes: string[] = []
      const { adapter } = await createAdapter(markdown, (next) => changes.push(next))
      expect(adapter.getMarkdown(), fixtureName).toBe(markdown)
      expect(changes, fixtureName).toEqual([])
      // Crepe's list-item NodeView mounts through Vue and schedules its initial
      // selection on a later frame. Let that owned callback settle before
      // destroying this fixture's editor and constructing the next one.
      await new Promise<void>((resolveFrame) => window.setTimeout(resolveFrame, 35))
      await adapter.destroy()
      adapters.splice(adapters.indexOf(adapter), 1)
    }
  }, 20_000)

  it('edits YAML safely while preserving unrelated fences, HTML, and line endings', async () => {
    const markdown = [
      '---',
      'title: "原样"',
      'order: [b, a]',
      '---',
      '',
      '正文',
      '',
      '~~~ts',
      'const value = 1',
      '~~~',
      '',
      '<div onclick="never()">raw</div>',
      '',
    ].join('\r\n')
    const { adapter, root } = await createAdapter(markdown)
    const source = root.querySelector<HTMLTextAreaElement>('[aria-label="YAML Front Matter 源码"]')

    expect(source).not.toBeNull()
    source!.value = 'title: "已编辑"\norder: [b, a]'
    source!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const saved = adapter.getMarkdown()

    expect(saved).toContain('title: "已编辑"\r\norder: [b, a]')
    expect(saved).toContain('~~~ts\r\nconst value = 1\r\n~~~')
    expect(saved).toContain('<div onclick="never()">raw</div>\r\n')
    expect(saved).not.toContain('```ts')
  })

  it('renders all GFM alert kinds and keeps their Markdown representation', async () => {
    const markdown = await readFile(resolve(fixtureDirectory, 'alerts.md'), 'utf8')
    const { adapter, root } = await createAdapter(markdown)
    const alerts = root.querySelectorAll<HTMLElement>('[data-openmd-alert]')

    expect([...alerts].map((alert) => alert.dataset.openmdAlert)).toEqual([
      'NOTE',
      'TIP',
      'IMPORTANT',
      'WARNING',
      'CAUTION',
    ])
    expect(alerts[1]?.textContent).toContain('这是 TIP')
    expect(adapter.getMarkdown()).toBe(markdown)
  })

  it('preserves reference links and definitions and resolves safe visual destinations', async () => {
    const markdown = await readFile(resolve(fixtureDirectory, 'reference-links.md'), 'utf8')
    const { adapter, root } = await createAdapter(markdown)
    const links = root.querySelectorAll<HTMLAnchorElement>('[data-openmd-link-reference]')
    const definitions = root.querySelectorAll('[data-openmd-reference-definition]')

    expect(links).toHaveLength(3)
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/openmd')
    expect(links[1]?.getAttribute('href')).toBe('./docs/guide.md')
    expect(definitions).toHaveLength(4)
    expect(root.querySelector('[data-openmd-image-reference]')?.textContent).toContain('引用图片')
    expect(adapter.getMarkdown()).toBe(markdown)
  })

  it('edits a reference definition and refreshes every resolved visual link', async () => {
    const markdown = await readFile(resolve(fixtureDirectory, 'reference-links.md'), 'utf8')
    const { adapter, root } = await createAdapter(markdown)
    const url = root.querySelector<HTMLInputElement>('[aria-label="引用定义 openmd URL"]')
    const title = root.querySelector<HTMLInputElement>('[aria-label="引用定义 openmd 标题"]')

    expect(url?.value).toBe('https://example.com/openmd')
    url!.value = 'https://example.com/edited'
    url!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    title!.value = '编辑后的标题'
    title!.dispatchEvent(new InputEvent('input', { bubbles: true }))

    expect(
      root.querySelector<HTMLAnchorElement>('[data-openmd-link-reference]')?.getAttribute('href'),
    ).toBe('https://example.com/edited')
    expect(adapter.getMarkdown()).toContain('[openmd]: https://example.com/edited "编辑后的标题"')
    expect(adapter.getMarkdown()).toContain('[完整引用][openmd]')
  })

  it('renders angle, email, and GFM bare autolinks with their original source intact', async () => {
    const markdown = await readFile(resolve(fixtureDirectory, 'autolinks.md'), 'utf8')
    const { adapter, root } = await createAdapter(markdown)
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a')]

    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      expect.arrayContaining([
        'https://example.com/a?x=1&y=2',
        'mailto:team@example.com',
        'https://example.org/path',
      ]),
    )
    expect(adapter.getMarkdown()).toBe(markdown)
  })

  it('keeps unsupported extension containers as editable raw Markdown blocks', async () => {
    const markdown = await readFile(resolve(fixtureDirectory, 'unsupported-raw.md'), 'utf8')
    const { adapter, root } = await createAdapter(markdown)
    const source = root.querySelector<HTMLTextAreaElement>(
      '[aria-label="暂不支持的 Markdown 源码"]',
    )

    expect(source?.value).toContain(':::custom-tabs active="中文"')
    expect(source?.value).toContain('<span data-owned="extension">')
    source!.value = source!.value.replace('扩展内容', '扩展内容已编辑')
    source!.dispatchEvent(new InputEvent('input', { bubbles: true }))

    const saved = adapter.getMarkdown()
    expect(saved).toContain(':::custom-tabs active="中文"\n## 扩展内容已编辑')
    expect(saved).toContain('\n:::\n\n后续正文不能被原始块吞掉。')
  })

  it('jumps from a footnote reference and shows a text-only hover preview', async () => {
    const markdown = await readFile(resolve(fixtureDirectory, 'footnotes.md'), 'utf8')
    const { adapter, root } = await createAdapter(markdown)
    const reference = root.querySelector<HTMLElement>('.openmd-footnote-reference')
    const definition = root.querySelector<HTMLElement>('dl[data-type="footnote_definition"]')
    const scrollIntoView = vi.fn()
    definition!.scrollIntoView = scrollIntoView

    reference!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    const preview = document.querySelector<HTMLElement>('.openmd-footnote-preview')
    expect(preview?.hidden).toBe(false)
    expect(preview?.textContent).toContain('第一段脚注')
    expect(preview?.querySelector('*')).toBeNull()

    reference!.click()
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(adapter.getMarkdown()).toBe(markdown)
  })

  it('never executes raw HTML and removes dangerous URLs from live link DOM', async () => {
    const markdown = [
      '[bad](javascript:window.__openmdUrlRan=true)',
      '',
      '<section onclick="window.__openmdEventRan=true">',
      '<script>window.__openmdScriptRan=true</script>',
      '</section>',
    ].join('\n')
    const { adapter, root } = await createAdapter(markdown)

    expect(root.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('#')
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('[onclick]')).toBeNull()
    expect(
      root.querySelector<HTMLTextAreaElement>('[aria-label="原始 HTML 源码"]')?.value,
    ).toContain('<script>')
    expect(Reflect.get(globalThis, '__openmdUrlRan')).toBeUndefined()
    expect(Reflect.get(globalThis, '__openmdEventRan')).toBeUndefined()
    expect(Reflect.get(globalThis, '__openmdScriptRan')).toBeUndefined()
    expect(adapter.getMarkdown()).toBe(markdown)
  })
})
