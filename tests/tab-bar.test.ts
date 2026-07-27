// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabBar } from '../src/renderer/src/components/TabBar'

afterEach(cleanup)

const tabs = [
  { id: 'one', title: 'one.md', dirty: false },
  { id: 'two', title: 'two.md', dirty: true },
  { id: 'three', title: 'three.md', dirty: false },
]

describe('accessible editor tabs', () => {
  it('moves and activates focus with arrows, Home, and End', () => {
    const onActivate = vi.fn()
    render(
      createElement(TabBar, {
        tabs,
        activeTabId: 'two',
        onActivate,
        onClose: vi.fn(),
        onCloseOthers: vi.fn(),
        onCloseRight: vi.fn(),
      }),
    )
    const active = screen.getByRole('tab', { name: /two\.md/u })
    active.focus()
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenLastCalledWith('three')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /three\.md/u }))

    fireEvent.keyDown(screen.getByRole('tab', { name: /three\.md/u }), { key: 'Home' })
    expect(onActivate).toHaveBeenLastCalledWith('one')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /one\.md/u }))
  })

  it('preserves dirty status and supports Delete and middle-click close', () => {
    const onClose = vi.fn()
    render(
      createElement(TabBar, {
        tabs,
        activeTabId: 'two',
        onActivate: vi.fn(),
        onClose,
        onCloseOthers: vi.fn(),
        onCloseRight: vi.fn(),
      }),
    )
    expect(screen.getByLabelText('未保存')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: /two\.md/u }), { key: 'Delete' })
    expect(onClose).toHaveBeenCalledWith('two')
    screen
      .getByRole('tab', { name: /three\.md/u })
      .parentElement!.dispatchEvent(
        new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
      )
    expect(onClose).toHaveBeenCalledWith('three')
  })
})
