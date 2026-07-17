// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { OpenMdEditorAdapter } from '../src/renderer/src/editor/editor-adapter'
import type { OutlineItem } from '../src/renderer/src/editor/outline-feature'

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
      value(this: SVGElement) {
        return {
          x: 0,
          y: 0,
          width: (this.textContent?.length ?? 0) * 8,
          height: 16,
        }
      },
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
  onOutlineChange?: (outline: readonly OutlineItem[]) => void,
): Promise<{ adapter: OpenMdEditorAdapter; root: HTMLDivElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const adapter = new OpenMdEditorAdapter({
    root,
    initialMarkdown: markdown,
    readOnly: false,
    onChange: () => undefined,
    onOutlineChange,
  })
  adapters.push(adapter)
  await adapter.create()
  return { adapter, root }
}

describe('phase 6 editor integration', () => {
  it('renders math, Mermaid, outline, and TOC without serializing generated DOM', async () => {
    let outline: readonly OutlineItem[] = []
    const source = [
      '[TOC]',
      '',
      '# 重复标题',
      '',
      '这是行内公式 $E = mc^2$。',
      '',
      '## 子标题',
      '',
      '$$',
      '\\int_0^1 x^2 dx',
      '$$',
      '',
      '# 重复标题',
      '',
      '```mermaid',
      'flowchart TD',
      '  A[开始] --> B[完成]',
      '```',
    ].join('\n')
    const { adapter, root } = await createAdapter(source, (nextOutline) => {
      outline = nextOutline
    })

    await vi.waitFor(() => {
      expect(root.querySelector('.openmd-math-inline')).not.toBeNull()
      expect(root.querySelector('.openmd-math-block')).not.toBeNull()
      expect(root.querySelector('.openmd-toc')).not.toBeNull()
    })
    await vi.waitFor(
      () => {
        const renderError = root.querySelector('.openmd-mermaid-error')
        if (renderError) throw new Error(renderError.textContent ?? 'Mermaid render failed')
        expect(root.querySelector('.openmd-mermaid-diagram svg')).not.toBeNull()
      },
      { timeout: 5_000, interval: 20 },
    )
    await vi.waitFor(() => {
      expect(root.querySelectorAll('[data-openmd-outline-id]')).toHaveLength(3)
      expect(root.querySelectorAll('.openmd-toc-link')).toHaveLength(3)
    })
    await vi.waitFor(() => expect(outline).toHaveLength(2))

    const flatOutline = outline.flatMap(function flatten(item): OutlineItem[] {
      return [item, ...item.children.flatMap(flatten)]
    })
    expect(flatOutline.map(({ level }) => level)).toEqual([1, 2, 1])
    expect(new Set(flatOutline.map(({ id }) => id)).size).toBe(3)

    const lastHeading = root.querySelectorAll<HTMLElement>('h1, h2').item(2)
    const scrollIntoView = vi.fn()
    lastHeading.scrollIntoView = scrollIntoView
    expect(adapter.scrollToHeading(flatOutline[2]!.id)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledOnce()

    const saved = adapter.getMarkdown()
    expect(saved.split('\n')[0]).toBe('[TOC]')
    expect(saved).toContain('$E = mc^2$')
    expect(saved).toContain('$$\n\\int_0^1 x^2 dx\n$$')
    expect(saved).toContain('```mermaid\nflowchart TD')
    expect(saved).not.toMatch(/<svg|katex|openmd-toc|data-openmd/i)

    adapter.setMarkdown(saved)
    expect(adapter.getMarkdown()).toBe(saved)
  })

  it('keeps invalid formulas and Mermaid blocks editable after isolated render errors', async () => {
    const source = ['$\\frac{$', '', '```mermaid', 'flowchart TD', '  A -->', '```'].join('\n')
    const { adapter, root } = await createAdapter(source)

    const formula = root.querySelector<HTMLElement>('.openmd-math-inline')
    expect(formula?.dataset.state).toBe('error')
    formula?.querySelector<HTMLElement>('.openmd-math-preview')?.click()
    const input = formula?.querySelector<HTMLInputElement>('.openmd-math-source')
    expect(input?.hidden).toBe(false)
    input!.value = '\\frac{1}{2}'
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(formula?.dataset.state).toBe('ready')

    await vi.waitFor(
      () =>
        expect(root.querySelector('.openmd-mermaid-preview')?.className).toContain(
          'openmd-mermaid-error',
        ),
      { timeout: 3_000, interval: 20 },
    )
    const errorPreview = root.querySelector<HTMLElement>('.openmd-mermaid-error')
    const codeBlock = errorPreview?.closest<HTMLElement>('.milkdown-code-block')
    const codeMirrorHost = codeBlock?.querySelector<HTMLElement>('.codemirror-host')
    expect(codeMirrorHost?.classList.contains('hidden')).toBe(true)
    errorPreview?.click()
    await vi.waitFor(() => expect(codeMirrorHost?.classList.contains('hidden')).toBe(false))

    const saved = adapter.getMarkdown()
    expect(saved).toContain('$\\frac{1}{2}$')
    expect(saved).toContain('```mermaid\nflowchart TD\n  A -->\n```')
    expect(saved).not.toContain('<svg')
  })
})
