// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NavigationSidebar } from '../src/renderer/src/components/NavigationSidebar'
import { clampSidebarWidth } from '../src/renderer/src/components/sidebar-layout'

afterEach(cleanup)

describe('unified navigation sidebar', () => {
  it('switches between files, search, and outline panels', async () => {
    const user = userEvent.setup()
    const onPanelChange = vi.fn()
    const { rerender } = render(
      createElement(NavigationSidebar, {
        panel: 'files',
        width: 280,
        files: createElement('p', {}, 'FILES PANEL'),
        search: createElement('p', {}, 'SEARCH PANEL'),
        outline: createElement('p', {}, 'OUTLINE PANEL'),
        onPanelChange,
        onCollapse: vi.fn(),
        onWidthChange: vi.fn(),
      }),
    )

    expect(screen.getByText('FILES PANEL')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: '搜索' }))
    expect(onPanelChange).toHaveBeenCalledWith('search')

    rerender(
      createElement(NavigationSidebar, {
        panel: 'outline',
        width: 280,
        files: createElement('p', {}, 'FILES PANEL'),
        search: createElement('p', {}, 'SEARCH PANEL'),
        outline: createElement('p', {}, 'OUTLINE PANEL'),
        onPanelChange,
        onCollapse: vi.fn(),
        onWidthChange: vi.fn(),
      }),
    )
    expect(screen.getByText('OUTLINE PANEL')).toBeTruthy()
  })

  it('clamps width and supports keyboard resize boundaries and collapse', () => {
    const onWidthChange = vi.fn()
    const onCollapse = vi.fn()
    render(
      createElement(NavigationSidebar, {
        panel: 'files',
        width: 220,
        files: null,
        search: null,
        outline: null,
        onPanelChange: vi.fn(),
        onCollapse,
        onWidthChange,
      }),
    )

    expect(clampSidebarWidth(20)).toBe(220)
    expect(clampSidebarWidth(900)).toBe(420)
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧栏宽度' }), {
      key: 'ArrowLeft',
    })
    expect(onWidthChange).toHaveBeenCalledWith(220)
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整侧栏宽度' }), {
      key: 'End',
    })
    expect(onWidthChange).toHaveBeenCalledWith(420)
    fireEvent.click(screen.getByRole('button', { name: '隐藏侧栏' }))
    expect(onCollapse).toHaveBeenCalledOnce()
  })
})
