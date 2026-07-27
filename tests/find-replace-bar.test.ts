// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FindReplaceBar } from '../src/renderer/src/components/FindReplaceBar'

afterEach(cleanup)

describe('document find and replace bar', () => {
  it('supports counted navigation, Enter directions, options and Escape', () => {
    const onChange = vi.fn()
    const onNext = vi.fn()
    const onClose = vi.fn()
    render(
      createElement(FindReplaceBar, {
        open: true,
        replaceVisible: true,
        value: {
          query: '正文',
          replacement: '内容',
          caseSensitive: false,
          wholeWord: false,
          regularExpression: false,
        },
        status: { current: 2, total: 8 },
        onChange,
        onNext,
        onReplace: vi.fn(),
        onReplaceAll: vi.fn(),
        onClose,
      }),
    )

    expect(screen.getByText('2/8')).toBeTruthy()
    const query = screen.getByRole('textbox', { name: '查找内容' })
    fireEvent.keyDown(query, { key: 'Enter' })
    fireEvent.keyDown(query, { key: 'Enter', shiftKey: true })
    expect(onNext.mock.calls).toEqual([[1], [-1]])

    fireEvent.click(screen.getByRole('button', { name: '正则表达式' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ regularExpression: true }))
    fireEvent.keyDown(query, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
