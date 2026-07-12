// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

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
})

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.destroy()))
  document.body.replaceChildren()
})

describe('phase 4 editor features', () => {
  it('mounts tables, CodeMirror, and the table context menu together', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const markdown = [
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| OpenMD | 开发中 |',
      '',
      '```java',
      'public class Main {',
      '}',
      '```',
    ].join('\n')
    const adapter = new OpenMdEditorAdapter({
      root,
      initialMarkdown: markdown,
      readOnly: false,
      onChange: () => undefined,
    })
    adapters.push(adapter)

    await adapter.create()

    expect(root.querySelector('.milkdown-table-block table')).not.toBeNull()
    expect(root.querySelector('.milkdown-code-block .cm-editor')).not.toBeNull()
    expect(root.querySelector('.milkdown-code-block .copy-button')?.textContent).toContain(
      '复制代码',
    )
    const cell = root.querySelector('td')
    expect(cell).not.toBeNull()
    cell?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 24,
        clientY: 24,
      }),
    )

    const menu = document.querySelector('.openmd-table-context-menu')
    expect(menu?.getAttribute('data-open')).toBe('true')
    expect(menu?.textContent).toContain('删除表格')
    const centerColumn = [...(menu?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === '列居中',
    )
    centerColumn?.click()

    const saved = adapter.getMarkdown()
    expect(saved).toContain('| OpenMD')
    expect(saved).toMatch(/\|\s*:-+:\s*\|/)
    expect(saved).toContain('```java')
    expect(saved).not.toMatch(/<table|data-openmd|milkdown/i)

    root
      .querySelector('td')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const deleteTable = [...(menu?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === '删除表格',
    )
    deleteTable?.click()
    expect(adapter.getMarkdown()).not.toContain('| OpenMD')
    expect(root.querySelector('.milkdown-table-block')).toBeNull()
  })

  it('updates the fenced info string when a language is selected', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const adapter = new OpenMdEditorAdapter({
      root,
      initialMarkdown: '```java\nclass Main {}\n```',
      readOnly: false,
      onChange: () => undefined,
    })
    adapters.push(adapter)
    await adapter.create()

    root.querySelector<HTMLButtonElement>('.milkdown-code-block .language-button')?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const pythonOption = root.querySelector<HTMLElement>(
      '.milkdown-code-block [data-language="python"]',
    )
    expect(pythonOption).not.toBeNull()
    pythonOption?.click()

    expect(adapter.getMarkdown()).toContain('```python')
  })
})
