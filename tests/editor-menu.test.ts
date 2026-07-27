import { beforeEach, describe, expect, it, vi } from 'vitest'

const { buildFromTemplate, setApplicationMenu } = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: unknown) => template),
  setApplicationMenu: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    name: 'OpenMD',
    quit: vi.fn(),
  },
  Menu: {
    buildFromTemplate,
    getApplicationMenu: () => undefined,
    setApplicationMenu,
  },
}))

import { installApplicationMenu } from '../src/main/menu'

describe('editor view menu', () => {
  beforeEach(() => {
    buildFromTemplate.mockClear()
    setApplicationMenu.mockClear()
  })

  it('exposes source mode and source display commands', () => {
    const sendCommand = vi.fn()
    installApplicationMenu([], sendCommand)

    const template = buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label?: string
      submenu?: Array<{
        accelerator?: string
        click?: () => void
        label?: string
        type?: string
      }>
    }>
    const viewMenu = template.find((item) => item.label === '视图')
    const modeItem = viewMenu?.submenu?.find((item) => item.label === '切换编辑模式')
    const lineNumbersItem = viewMenu?.submenu?.find((item) => item.label === '切换源码行号')
    const wrappingItem = viewMenu?.submenu?.find((item) => item.label === '切换长行自动换行')
    const focusItem = viewMenu?.submenu?.find((item) => item.label === '专注模式')
    const typewriterItem = viewMenu?.submenu?.find((item) => item.label === '打字机模式')

    expect(modeItem?.accelerator).toBe('CmdOrCtrl+/')
    expect(focusItem).toMatchObject({ accelerator: 'F8', type: 'checkbox' })
    expect(typewriterItem).toMatchObject({ accelerator: 'F9', type: 'checkbox' })
    modeItem?.click?.()
    lineNumbersItem?.click?.()
    wrappingItem?.click?.()

    expect(sendCommand.mock.calls).toEqual([
      [{ type: 'toggle-editor-mode' }],
      [{ type: 'toggle-source-line-numbers' }],
      [{ type: 'toggle-source-line-wrapping' }],
    ])
  })

  it('uses the shared definitions for find, quick open, tabs and settings', () => {
    installApplicationMenu([], vi.fn())
    const template = buildFromTemplate.mock.calls[0]?.[0] as Array<{
      label?: string
      submenu?: Array<{ accelerator?: string; label?: string }>
    }>
    const allItems = template.flatMap((menu) => menu.submenu ?? [])
    expect(allItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '快速打开…', accelerator: 'CmdOrCtrl+P' }),
        expect.objectContaining({ label: '关闭当前标签', accelerator: 'CmdOrCtrl+W' }),
        expect.objectContaining({
          label: '恢复最近关闭的标签',
          accelerator: 'CmdOrCtrl+Shift+T',
        }),
        expect.objectContaining({ label: '查找…', accelerator: 'CmdOrCtrl+F' }),
        expect.objectContaining({ label: '替换…', accelerator: 'CmdOrCtrl+H' }),
        expect.objectContaining({ label: '设置…', accelerator: 'CmdOrCtrl+,' }),
      ]),
    )
  })
})
