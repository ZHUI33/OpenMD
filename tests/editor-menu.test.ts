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
      }>
    }>
    const viewMenu = template.find((item) => item.label === '视图')
    const modeItem = viewMenu?.submenu?.find((item) => item.label === '切换编辑模式')
    const lineNumbersItem = viewMenu?.submenu?.find((item) => item.label === '切换源码行号')
    const wrappingItem = viewMenu?.submenu?.find((item) => item.label === '切换长行自动换行')

    expect(modeItem?.accelerator).toBe('CmdOrCtrl+/')
    modeItem?.click?.()
    lineNumbersItem?.click?.()
    wrappingItem?.click?.()

    expect(sendCommand.mock.calls).toEqual([
      [{ type: 'toggle-editor-mode' }],
      [{ type: 'toggle-source-line-numbers' }],
      [{ type: 'toggle-source-line-wrapping' }],
    ])
  })
})
