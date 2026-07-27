// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MermaidPreviewController,
  type MermaidRenderEngine,
} from '../src/renderer/src/editor/mermaid-feature'

const originalObserver = window.IntersectionObserver

afterEach(() => {
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    value: originalObserver,
  })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('viewport-gated complex rendering', () => {
  it('does not invoke Mermaid until the preview approaches the viewport', async () => {
    let observerCallback: IntersectionObserverCallback | undefined
    let observedTarget: Element | undefined
    class ControlledIntersectionObserver {
      readonly root = null
      readonly rootMargin = '600px 0px'
      readonly thresholds = [0]
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }
      observe(target: Element): void {
        observedTarget = target
      }
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
      unobserve(): void {}
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: ControlledIntersectionObserver,
    })
    const render = vi.fn<MermaidRenderEngine['render']>(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>lazy</text></svg>',
    }))
    const controller = new MermaidPreviewController({
      debounceMs: 0,
      engine: { initialize: vi.fn(), render },
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    controller.attach(root)
    root.appendChild(controller.createPreview('flowchart LR\nA --> B', vi.fn(), document))
    await Promise.resolve()

    expect(observedTarget).toBeTruthy()
    expect(render).not.toHaveBeenCalled()
    observerCallback?.(
      [
        {
          target: observedTarget!,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: new DOMRect(),
          intersectionRect: new DOMRect(),
          rootBounds: null,
          time: performance.now(),
        },
      ],
      {} as IntersectionObserver,
    )
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce())
    controller.destroy()
  })
})
