// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExportDialog } from '../src/renderer/src/components/ExportDialog'

afterEach(cleanup)

describe('ExportDialog', () => {
  it('submits the selected standalone HTML image strategy', async () => {
    const user = userEvent.setup()
    const onExportHtml = vi.fn()
    render(
      createElement(ExportDialog, {
        defaultTitle: 'Example',
        onClose: vi.fn(),
        onExportHtml,
        onExportPdf: vi.fn(),
      }),
    )

    await user.click(screen.getByLabelText('嵌入 Base64（本地图片）'))
    await user.click(screen.getByRole('button', { name: '选择保存位置' }))

    expect(onExportHtml).toHaveBeenCalledWith('Example', 'base64')
  })

  it('submits Letter PDF options without exposing application chrome settings', async () => {
    const user = userEvent.setup()
    const onExportPdf = vi.fn()
    render(
      createElement(ExportDialog, {
        mode: 'pdf',
        defaultTitle: 'Print me',
        onClose: vi.fn(),
        onExportHtml: vi.fn(),
        onExportPdf,
      }),
    )

    await user.selectOptions(screen.getByLabelText('纸张'), 'Letter')
    await user.clear(screen.getByLabelText('页边距（mm）'))
    await user.type(screen.getByLabelText('页边距（mm）'), '18')
    await user.click(screen.getByRole('button', { name: '选择保存位置' }))

    expect(onExportPdf).toHaveBeenCalledWith('Print me', {
      pageSize: 'Letter',
      marginMm: 18,
      printBackground: true,
    })
    expect(screen.queryByText(/侧边栏/u)).toBeNull()
  })
})
