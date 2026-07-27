// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceEntryNameDialog } from '../src/renderer/src/components/WorkspaceEntryDialogs'
import { validateWorkspaceEntryName } from '../src/renderer/src/components/workspace-entry-utils'

afterEach(cleanup)

describe('workspace entry dialogs', () => {
  it('autofocuses and confirms a valid file name with Enter', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => undefined)
    render(
      createElement(WorkspaceEntryNameDialog, {
        mode: 'create-file',
        initialValue: '草稿.md',
        onCancel: vi.fn(),
        onConfirm,
      }),
    )
    const input = screen.getByRole('textbox', { name: '名称' })
    expect(document.activeElement).toBe(input)
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledWith('草稿.md')
  })

  it('cancels with Escape and validates names before submission', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      createElement(WorkspaceEntryNameDialog, {
        mode: 'create-directory',
        initialValue: '新目录',
        onCancel,
        onConfirm: vi.fn(async () => undefined),
      }),
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(validateWorkspaceEntryName('../outside', 'create-directory')).toBeDefined()
    expect(validateWorkspaceEntryName('notes.txt', 'create-file')).toMatch(/Markdown/u)
  })
})
