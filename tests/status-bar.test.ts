// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { StatusBar } from '../src/renderer/src/components/StatusBar'
import { useAppStore } from '../src/renderer/src/stores/app-store'

const mountedRoots: Root[] = []

beforeAll(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })
})

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

async function renderStatusBar(): Promise<string> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => root.render(createElement(StatusBar)))
  return container.textContent ?? ''
}

describe('editor status bar', () => {
  beforeEach(() => {
    useAppStore.getState().setDocument('中文 🚀')
    useAppStore.getState().setEditorMode('visual')
    useAppStore.getState().setSourceCursor({ line: 1, column: 1 })
  })

  it('shows the visual mode label by default', async () => {
    const status = await renderStatusBar()

    expect(status).toContain('所见即所得')
    expect(status).not.toContain('Markdown 源码')
  })

  it('shows source line, column, and Unicode character count', async () => {
    useAppStore.getState().setEditorMode('source')
    useAppStore.getState().setSourceCursor({ line: 12, column: 4 })

    const status = await renderStatusBar()

    expect(status).toContain('Markdown 源码')
    expect(status).toContain('行 12 · 列 4 · 4 字符')
  })
})
