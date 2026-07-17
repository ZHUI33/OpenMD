// @vitest-environment jsdom

import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { defaultConfig } from '@milkdown/kit/component/code-block'
import { Editor, parserCtx, rootCtx, serializerCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { configureOpenMdCodeBlocks } from '../src/renderer/src/editor/code-block-config'
import {
  MermaidPreviewController,
  OPENMD_MERMAID_CONFIG,
  createOpenMdMermaidFeature,
  createMermaidRenderId,
  extendCodeBlockConfigWithMermaid,
  isMermaidLanguage,
  isSafeMermaidLink,
  sanitizeMermaidSvg,
  validateMermaidSourceSafety,
  type MermaidRenderEngine,
} from '../src/renderer/src/editor/mermaid-feature'

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><text x="1" y="12">OK</text></svg>'

class FakeMermaidEngine implements MermaidRenderEngine {
  readonly configurations: Parameters<MermaidRenderEngine['initialize']>[0][] = []
  readonly renders: Array<{
    container: Element
    containerWasConnected: boolean
    id: string
    source: string
  }> = []
  result: (id: string, source: string) => Promise<{ svg: string }> = async () => ({
    svg: VALID_SVG,
  })

  initialize(config: Parameters<MermaidRenderEngine['initialize']>[0]): void {
    this.configurations.push(config)
  }

  async render(id: string, source: string, container: Element): Promise<{ svg: string }> {
    this.renders.push({ container, containerWasConnected: container.isConnected, id, source })
    return this.result(id, source)
  }
}

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

let editor: Editor
let parseMarkdown: (markdown: string) => ProseMirrorNode
let serializeMarkdown: (document: ProseMirrorNode) => string
const crepes: Crepe[] = []

beforeAll(async () => {
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

  const root = document.createElement('div')
  document.body.appendChild(root)
  editor = Editor.make()
    .config((ctx) => ctx.set(rootCtx, root))
    .use(commonmark)
  await editor.create()
  parseMarkdown = editor.action((ctx) => ctx.get(parserCtx))
  serializeMarkdown = editor.action((ctx) => ctx.get(serializerCtx))
})

afterEach(async () => {
  await Promise.all(crepes.splice(0).map((crepe) => crepe.destroy()))
  vi.useRealTimers()
  document.body.querySelectorAll('[id^="openmd-mermaid-"]').forEach((node) => node.remove())
  document.body.querySelectorAll('.mermaid-integration-root').forEach((node) => node.remove())
})

afterAll(async () => {
  await editor.destroy()
  document.body.replaceChildren()
})

function mountPreview(
  controller: MermaidPreviewController,
  source: string,
): { applied: HTMLElement[]; preview: HTMLElement } {
  const applied: HTMLElement[] = []
  const preview = controller.createPreview(source, (value) => {
    if (!(value instanceof HTMLElement)) return
    applied.push(value)
    document.getElementById(value.id)?.replaceWith(value)
  })
  document.body.appendChild(preview)
  return { applied, preview }
}

async function nextDomUpdate(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('Mermaid fenced Markdown', () => {
  it('recognizes only the mermaid info string', () => {
    expect(isMermaidLanguage('mermaid')).toBe(true)
    expect(isMermaidLanguage(' MERMAID ')).toBe(true)
    expect(isMermaidLanguage('mmd')).toBe(false)
    expect(isMermaidLanguage('javascript')).toBe(false)
  })

  it('opens and saves a Mermaid block as standard fenced Markdown', () => {
    const source = ['```mermaid', 'sequenceDiagram', '  Alice->>Bob: Hello', '```'].join('\n')
    const opened = parseMarkdown(source)
    const block = opened.firstChild

    expect(block?.type.name).toBe('code_block')
    expect(block?.attrs.language).toBe('mermaid')
    expect(serializeMarkdown(opened)).toContain(source)
    expect(serializeMarkdown(parseMarkdown(serializeMarkdown(opened)))).toBe(
      serializeMarkdown(opened),
    )
  })

  it('adds Mermaid to the picker without changing non-Mermaid previews', () => {
    const engine = new FakeMermaidEngine()
    const controller = new MermaidPreviewController({ engine })
    const previousPreview = vi.fn(() => null)
    const config = extendCodeBlockConfigWithMermaid(
      { ...defaultConfig, languages: [], renderPreview: previousPreview },
      controller,
    )

    expect(config.languages.map(({ name }) => name)).toEqual(['mermaid'])
    expect(config.previewOnlyByDefault).toBe(defaultConfig.previewOnlyByDefault)
    expect(config.renderPreview('typescript', 'const ok = true', vi.fn())).toBeNull()
    expect(previousPreview).toHaveBeenCalledOnce()
    controller.destroy()
  })

  it('keeps ordinary fenced code in source mode when its preview renderer returns null', async () => {
    const root = document.createElement('div')
    root.className = 'mermaid-integration-root'
    document.body.appendChild(root)
    const feature = createOpenMdMermaidFeature({ engine: new FakeMermaidEngine(), debounceMs: 0 })
    const crepe = new Crepe({
      root,
      defaultValue: [
        '```typescript',
        'const answer = 42',
        '```',
        '',
        '```mermaid',
        'flowchart TD',
        '  A-->B',
        '```',
      ].join('\n'),
      features: {
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.Toolbar]: false,
      },
    })
    crepes.push(crepe)
    crepe.editor.config(configureOpenMdCodeBlocks)
    crepe.editor.config(feature.configureCodeBlocks)
    crepe.editor.use(feature.plugins)

    await crepe.create()
    await nextDomUpdate()

    await vi.waitFor(() => {
      const blocks = root.querySelectorAll<HTMLElement>('.milkdown-code-block')
      expect(blocks).toHaveLength(2)
      expect(blocks[0]?.querySelector('.codemirror-host')?.classList).not.toContain('hidden')
      expect(blocks[0]?.querySelector('.openmd-mermaid-preview')).toBeNull()
      expect(blocks[1]?.querySelector('.codemirror-host')?.classList).toContain('hidden')
      expect(blocks[1]?.querySelector('.openmd-mermaid-preview')).not.toBeNull()
    })
  })

  it('uses the CodeMirror NodeView to edit source and returns to preview on blur', async () => {
    const root = document.createElement('div')
    root.className = 'mermaid-integration-root'
    document.body.appendChild(root)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const engine = new FakeMermaidEngine()
    const feature = createOpenMdMermaidFeature({ engine, debounceMs: 0 })
    const source = '```mermaid\nflowchart TD\n  A-->B\n```'
    const crepe = new Crepe({
      root,
      defaultValue: source,
      features: {
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.Latex]: false,
        [CrepeFeature.Toolbar]: false,
      },
    })
    crepes.push(crepe)
    crepe.editor.config(configureOpenMdCodeBlocks)
    crepe.editor.config(feature.configureCodeBlocks)
    crepe.editor.use(feature.plugins)

    await crepe.create()
    await nextDomUpdate()

    const preview = root.querySelector<HTMLElement>('.openmd-mermaid-preview')
    const editorHost = root.querySelector<HTMLElement>('.codemirror-host')
    expect(preview).not.toBeNull()
    await vi.waitFor(() => expect(editorHost?.classList).toContain('hidden'))

    preview?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await nextDomUpdate()
    expect(editorHost?.classList).not.toContain('hidden')

    const codeMirrorContent = root.querySelector<HTMLElement>('.cm-content')
    codeMirrorContent?.focus()
    outside.focus()
    await nextDomUpdate()
    expect(editorHost?.classList).toContain('hidden')
    expect(crepe.getMarkdown()).toContain(source)
    outside.remove()
  })

  it.each([
    ['flowchart', 'flowchart TD\n  A-->B'],
    ['sequenceDiagram', 'sequenceDiagram\n  Alice->>Bob: Hello'],
    ['classDiagram', 'classDiagram\n  class Animal {\n    +String name\n  }'],
    ['stateDiagram', 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]'],
    [
      'gantt',
      'gantt\n  title Release\n  dateFormat YYYY-MM-DD\n  section Work\n  Build :done, 2026-01-01, 1d',
    ],
    ['pie', 'pie title Results\n  "Yes" : 70\n  "No" : 30'],
  ])('accepts the required %s syntax in strict mode', async (_kind, source) => {
    const { default: realMermaid } = await import('mermaid')
    realMermaid.initialize(OPENMD_MERMAID_CONFIG)

    expect(() => validateMermaidSourceSafety(source)).not.toThrow()
    await expect(realMermaid.parse(source)).resolves.toBeTruthy()
  })
})

describe('Mermaid rendering lifecycle', () => {
  it('uses unique render IDs and strict locked configuration', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    const controller = new MermaidPreviewController({ engine, debounceMs: 25 })
    const { applied } = mountPreview(controller, 'flowchart TD\nA-->B')

    await vi.advanceTimersByTimeAsync(24)
    expect(engine.renders).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(engine.configurations).toHaveLength(1)
    expect(engine.configurations[0]).toMatchObject({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      htmlLabels: false,
    })
    expect(engine.configurations[0]?.secure).toContain('securityLevel')
    expect(engine.renders).toHaveLength(1)
    expect(engine.renders[0]?.containerWasConnected).toBe(true)
    expect(engine.renders[0]?.container.parentElement).toBeNull()
    expect(engine.renders[0]?.container.getAttribute('aria-hidden')).toBe('true')
    expect(engine.renders[0]?.container.getAttribute('style')).toContain('visibility: hidden')
    expect(document.querySelector('[data-openmd-mermaid-render-host]')).toBeNull()
    expect(applied[0]?.classList).toContain('openmd-mermaid-diagram')

    const ids = new Set(Array.from({ length: 30 }, () => createMermaidRenderId()))
    expect(ids.size).toBe(30)
    controller.destroy()
  })

  it('debounces stale source and never applies an obsolete async result', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    const controller = new MermaidPreviewController({ engine, debounceMs: 40 })
    const first = mountPreview(controller, 'flowchart TD\nOld-->Value')
    const secondApplied: HTMLElement[] = []
    const second = controller.createPreview('flowchart TD\nNew-->Value', (value) => {
      if (value instanceof HTMLElement) secondApplied.push(value)
    })
    first.preview.replaceWith(second)

    await vi.advanceTimersByTimeAsync(40)

    expect(engine.renders.map(({ source }) => source)).toEqual(['flowchart TD\nNew-->Value'])
    expect(first.applied).toHaveLength(0)
    expect(secondApplied).toHaveLength(1)
    controller.destroy()
  })

  it('cancels the previous debounce timer when a NodeView reuses its preview callback', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    const controller = new MermaidPreviewController({ engine, debounceMs: 40 })
    const applyPreview = vi.fn()
    const first = controller.createPreview('flowchart TD\nOld-->Value', applyPreview)
    document.body.appendChild(first)
    const latest = controller.createPreview('flowchart TD\nNew-->Value', applyPreview)
    first.replaceWith(latest)

    await vi.advanceTimersByTimeAsync(40)

    expect(engine.renders.map(({ source }) => source)).toEqual(['flowchart TD\nNew-->Value'])
    expect(applyPreview).toHaveBeenCalledOnce()
    controller.destroy()
  })

  it('does not let a slow obsolete render overwrite newer source', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    let resolveOldRender: ((result: { svg: string }) => void) | undefined
    engine.result = (_id, source) => {
      if (source.includes('Old')) {
        return new Promise((resolve) => {
          resolveOldRender = resolve
        })
      }
      return Promise.resolve({ svg: VALID_SVG.replace('OK', 'NEW') })
    }
    const controller = new MermaidPreviewController({ engine, debounceMs: 10 })
    const old = mountPreview(controller, 'flowchart TD\nOld-->Value')

    await vi.advanceTimersByTimeAsync(10)
    expect(engine.renders).toHaveLength(1)

    const latestApplied: HTMLElement[] = []
    const latest = controller.createPreview('flowchart TD\nNew-->Value', (value) => {
      if (value instanceof HTMLElement) latestApplied.push(value)
    })
    old.preview.replaceWith(latest)
    await vi.advanceTimersByTimeAsync(10)
    expect(engine.renders).toHaveLength(2)
    expect(latestApplied[0]?.textContent).toContain('NEW')

    resolveOldRender?.({ svg: VALID_SVG.replace('OK', 'OLD') })
    await Promise.resolve()

    expect(old.applied).toHaveLength(0)
    expect(latestApplied).toHaveLength(1)
    controller.destroy()
  })

  it('isolates syntax errors in an editable per-chart error preview', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    engine.result = async () => {
      throw new Error('Parse error near line 2')
    }
    const controller = new MermaidPreviewController({ engine, debounceMs: 0 })
    const { applied } = mountPreview(controller, 'not-a-diagram')

    await vi.runAllTimersAsync()

    expect(applied).toHaveLength(1)
    expect(applied[0]?.classList).toContain('openmd-mermaid-error')
    expect(applied[0]?.getAttribute('role')).toBe('alert')
    expect(applied[0]?.textContent).toContain('Parse error near line 2')
    controller.destroy()
  })

  it('cancels timers and ignores pending work when destroyed', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    const controller = new MermaidPreviewController({ engine, debounceMs: 30 })
    mountPreview(controller, 'pie\n  "A" : 1')

    controller.destroy()
    await vi.runAllTimersAsync()

    expect(engine.renders).toHaveLength(0)
  })

  it('removes an active owned render host immediately when destroyed', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    engine.result = () => new Promise<{ svg: string }>(() => undefined)
    const controller = new MermaidPreviewController({ engine, debounceMs: 0 })
    mountPreview(controller, 'flowchart TD\nA-->B')

    await vi.advanceTimersByTimeAsync(0)
    expect(document.querySelector('[data-openmd-mermaid-render-host]')).not.toBeNull()

    controller.destroy()

    expect(document.querySelector('[data-openmd-mermaid-render-host]')).toBeNull()
  })
})

describe('Mermaid SVG safety', () => {
  it('allows ordinary labels ending in substrings that resemble URI schemes', () => {
    expect(() =>
      validateMermaidSourceSafety(
        'flowchart TD\nA[Profile: ready]\nB[Metadata: ready]\nC[Hotel: ready]',
      ),
    ).not.toThrow()
  })

  it.each([
    [
      'frontmatter',
      '---\nconfig:\n  themeCSS: "@import https://evil.example/x.css"\n---\nflowchart TD\nA-->B',
    ],
    [
      'init directive',
      '%%{init: {"fontFamily": "url(https://evil.example/font)"}}%%\nflowchart TD\nA-->B',
    ],
    ['config directive', '%%{config: {"themeCSS": "rect{}"}}%%\nflowchart TD\nA-->B'],
    ['CSS URL', 'flowchart TD\nA-->B\nclassDef bad fill:url(https://evil.example/a.svg)'],
    [
      'escaped CSS URL',
      String.raw`flowchart TD
A-->B
classDef bad fill:u\72 l(https://evil.example/a.svg)`,
    ],
    [
      'continued CSS URL',
      ['flowchart TD', 'A-->B', 'classDef bad fill:u\\', 'rl(https://evil.example/a.svg)'].join(
        '\n',
      ),
    ],
    ['CSS import', 'flowchart TD\nA-->B\nclassDef bad @import "https://evil.example/x.css"'],
    [
      'CSS image-set',
      'flowchart TD\nA-->B\nclassDef bad fill:image-set("https://evil.example/a.png" 1x)',
    ],
    ['image shape', 'flowchart TD\nA@{ img: "https://evil.example/a.png" }'],
    ['HTML image', 'flowchart TD\nA[<img src="https://evil.example/a.png">]'],
    ['external link', 'flowchart TD\nA-->B\nclick A "https://evil.example"'],
    ['script callback', 'flowchart TD\nA-->B\nclick A call evil()'],
    ['dangerous URI', 'sequenceDiagram\nAlice->>Bob: javascript:alert(1)'],
  ])('rejects %s before rendering', (_kind, source) => {
    expect(() => validateMermaidSourceSafety(source)).toThrow(/Mermaid 安全策略拒绝渲染/)
  })

  it('shows a recoverable policy error without invoking Mermaid or leaving a render host', async () => {
    vi.useFakeTimers()
    const engine = new FakeMermaidEngine()
    const controller = new MermaidPreviewController({ engine, debounceMs: 0 })
    const { applied } = mountPreview(
      controller,
      'flowchart TD\nA-->B\nclassDef bad fill:url(https://evil.example/a.svg)',
    )

    await vi.runAllTimersAsync()

    expect(engine.configurations).toHaveLength(0)
    expect(engine.renders).toHaveLength(0)
    expect(document.querySelector('[data-openmd-mermaid-render-host]')).toBeNull()
    expect(applied[0]?.classList).toContain('openmd-mermaid-error')
    expect(applied[0]?.textContent).toContain('安全策略拒绝渲染')
    expect(applied[0]?.textContent).toContain('源码未被修改')
    controller.destroy()
  })

  it.each([
    ['https://example.com/path', true],
    ['http://example.com/path', true],
    ['mailto:hello@example.com', true],
    ['#local-marker', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>alert(1)</script>', false],
    ['file:///etc/passwd', false],
    ['/relative/path', false],
  ])('classifies link %s', (link, safe) => {
    expect(isSafeMermaidLink(link)).toBe(safe)
  })

  it('removes scripts, event handlers, foreign content, and dangerous protocols', () => {
    const preview = sanitizeMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
        <style>@import url(https://evil.example/style.css);</style>
        <rect style="fill:url(javascript:alert(1))" />
        <circle fill="url(https://evil.example/tracker.svg)" />
        <image href="https://evil.example/tracker.svg" />
        <a id="unsafe" href="javascript:alert(1)" onclick="alert(1)"><text>bad</text></a>
        <a id="safe" href="https://example.com"><text>safe</text></a>
      </svg>
    `)
    const svg = preview.querySelector('svg')

    expect(svg).not.toBeNull()
    expect(svg?.querySelector('script, foreignObject, style')).toBeNull()
    expect(svg?.getAttribute('onload')).toBeNull()
    expect(svg?.querySelector('#unsafe')?.getAttribute('href')).toBeNull()
    expect(svg?.querySelector('#unsafe')?.getAttribute('onclick')).toBeNull()
    expect(svg?.querySelector('rect')?.getAttribute('style')).toBeNull()
    expect(svg?.querySelector('circle')?.getAttribute('fill')).toBeNull()
    expect(svg?.querySelector('image')?.getAttribute('href')).toBeNull()
    expect(svg?.querySelector('#safe')?.getAttribute('href')).toBe('https://example.com')
    expect(svg?.querySelector('#safe')?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('exports an explicitly strict Mermaid configuration', () => {
    expect(OPENMD_MERMAID_CONFIG.securityLevel).toBe('strict')
    expect(OPENMD_MERMAID_CONFIG.startOnLoad).toBe(false)
    expect(OPENMD_MERMAID_CONFIG.htmlLabels).toBe(false)
    expect(OPENMD_MERMAID_CONFIG.dompurifyConfig?.FORBID_TAGS).toContain('script')
    expect(OPENMD_MERMAID_CONFIG.secure).toEqual(
      expect.arrayContaining([
        'secure',
        'fontFamily',
        'altFontFamily',
        'themeCSS',
        'themeVariables',
        'theme',
        'fontSize',
      ]),
    )
  })
})
