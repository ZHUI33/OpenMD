// @vitest-environment jsdom

import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  OPENMD_INLINE_MATH_NODE_NAME,
  createMathBlockPreview,
  createOpenMdMathFeature,
  openMdMathFeatures,
  renderMathSafely,
} from '../src/renderer/src/editor/math-feature'

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

interface MathEditorHarness {
  crepe: Crepe
  root: HTMLElement
}

const editors: Crepe[] = []

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
})

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()))
  document.body.replaceChildren()
})

async function createMathEditor(markdown: string): Promise<MathEditorHarness> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const mathFeature = createOpenMdMathFeature()
  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: {
      [CrepeFeature.Cursor]: false,
      [CrepeFeature.ListItem]: false,
      [CrepeFeature.LinkTooltip]: false,
      [CrepeFeature.ImageBlock]: false,
      [CrepeFeature.BlockEdit]: false,
      [CrepeFeature.Toolbar]: false,
      [CrepeFeature.Placeholder]: false,
      [CrepeFeature.Table]: false,
      [CrepeFeature.TopBar]: false,
      [CrepeFeature.AI]: false,
      [CrepeFeature.CodeMirror]: true,
      ...openMdMathFeatures,
    },
  })
  crepe.editor.config(mathFeature.configure)
  crepe.editor.use(mathFeature.plugins)
  editors.push(crepe)
  await crepe.create()
  return { crepe, root }
}

function mathNodes(crepe: Crepe): ProseMirrorNode[] {
  return crepe.editor.action((ctx) => {
    const nodes: ProseMirrorNode[] = []
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      if (
        node.type.name === OPENMD_INLINE_MATH_NODE_NAME ||
        (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex')
      ) {
        nodes.push(node)
      }
    })
    return nodes
  })
}

describe('math Markdown feature', () => {
  it('round-trips inline math as standard dollar-delimited Markdown', async () => {
    const { crepe } = await createMathEditor('这是行内公式 $E = mc^2$。')

    expect(mathNodes(crepe)).toHaveLength(1)
    expect(mathNodes(crepe)[0]?.attrs.value).toBe('E = mc^2')

    const saved = crepe.getMarkdown()
    expect(saved).toContain('$E = mc^2$')
    expect(saved).not.toMatch(/<span|katex|data-math/i)
  })

  it('round-trips block math as standard double-dollar Markdown', async () => {
    const source = ['正文', '', '$$', '\\int_0^1 x^2 dx', '$$'].join('\n')
    const { crepe, root } = await createMathEditor(source)

    expect(mathNodes(crepe)).toHaveLength(1)
    expect(mathNodes(crepe)[0]?.textContent).toBe('\\int_0^1 x^2 dx')

    await Promise.resolve()
    const block = root.querySelector<HTMLElement>('.milkdown-code-block')
    const codeMirrorHost = block?.querySelector<HTMLElement>('.codemirror-host')
    const preview = block?.querySelector<HTMLElement>('.openmd-math-block')
    expect(codeMirrorHost?.classList.contains('hidden')).toBe(true)

    preview?.click()
    await Promise.resolve()
    expect(codeMirrorHost?.classList.contains('hidden')).toBe(false)

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    await Promise.resolve()
    expect(codeMirrorHost?.classList.contains('hidden')).toBe(true)

    const saved = crepe.getMarkdown()
    expect(saved).toContain('$$\n\\int_0^1 x^2 dx\n$$')
    expect(saved).not.toMatch(/<svg|<span|katex|```latex/i)

    const reopened = await createMathEditor(saved)
    expect(mathNodes(reopened.crepe)[0]?.textContent).toBe('\\int_0^1 x^2 dx')
    expect(reopened.crepe.getMarkdown()).toBe(saved)
  })

  it('clicks into inline source editing and updates preview plus Markdown on every input', async () => {
    const { crepe, root } = await createMathEditor('公式 $x^2$。')
    const formula = root.querySelector<HTMLElement>('.openmd-math-inline')
    const preview = formula?.querySelector<HTMLElement>('.openmd-math-preview')
    const input = formula?.querySelector<HTMLInputElement>('.openmd-math-source')

    expect(formula?.dataset.state).toBe('ready')
    expect(input?.hidden).toBe(true)
    preview?.click()
    expect(input?.hidden).toBe(false)

    input!.value = '\\frac{'
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(formula?.dataset.state).toBe('error')
    expect(formula?.querySelector('.openmd-math-error')?.textContent).toContain('公式语法错误')
    expect(crepe.getMarkdown()).toContain('$\\frac{$')

    input!.value = '\\frac{1}{2}'
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(formula?.dataset.state).toBe('ready')
    expect(formula?.querySelector('.katex')).not.toBeNull()
    expect(crepe.getMarkdown()).toContain('$\\frac{1}{2}$')
  })

  it('isolates renderer errors and inserts untrusted source only as text', () => {
    const target = document.createElement('span')
    const source = '<img src=x onerror=alert(1)>'
    const outcome = renderMathSafely(source, target, {
      renderer: () => {
        throw new Error('synthetic parse failure')
      },
    })

    expect(outcome).toEqual({ ok: false, error: '公式语法错误：synthetic parse failure' })
    expect(target.querySelector('img')).toBeNull()
    expect(target.textContent).toBe(source)

    const block = createMathBlockPreview('\\frac{', undefined, document)
    expect(block.dataset.state).toBe('error')
    expect(block.querySelector('[role="alert"]')?.textContent).toContain('公式语法错误')
  })
})
