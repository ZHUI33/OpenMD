import { app, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { APP_COMMANDS } from '../shared/commands'
import type { AppCommandType } from '../shared/commands'
import type { AppCommandState, RecentFile, RendererCommand } from '../shared/desktop-api.types'

export type SendDocumentCommand = (command: RendererCommand) => void

let currentCommandState: AppCommandState = { focusMode: false, typewriterMode: false }

function commandItem(
  type: AppCommandType,
  sendCommand: SendDocumentCommand,
  options: Partial<MenuItemConstructorOptions> = {},
): MenuItemConstructorOptions {
  const definition = APP_COMMANDS[type]
  return {
    id: definition.id,
    label: definition.label,
    accelerator: definition.accelerator,
    click: () => sendCommand({ type } as RendererCommand),
    ...options,
  }
}

export function updateApplicationMenuCommandState(state: AppCommandState): void {
  currentCommandState = { ...state }
  const menu = Menu.getApplicationMenu()
  const focusItem = menu?.getMenuItemById(APP_COMMANDS['toggle-focus-mode'].id)
  const typewriterItem = menu?.getMenuItemById(APP_COMMANDS['toggle-typewriter-mode'].id)
  if (focusItem) focusItem.checked = state.focusMode
  if (typewriterItem) typewriterItem.checked = state.typewriterMode
}

function createRecentFilesSubmenu(
  recentFiles: readonly RecentFile[],
  sendCommand: SendDocumentCommand,
): MenuItemConstructorOptions[] {
  if (recentFiles.length === 0) return [{ label: '暂无最近文件', enabled: false }]

  return recentFiles.map((recentFile) => ({
    label: recentFile.name,
    toolTip: recentFile.path,
    click: () => {
      sendCommand({ type: 'open-recent', filePath: recentFile.path })
    },
  }))
}

export function installApplicationMenu(
  recentFiles: readonly RecentFile[],
  sendCommand: SendDocumentCommand,
): void {
  const isMac = process.platform === 'darwin'
  const fileSubmenu: MenuItemConstructorOptions[] = [
    commandItem('new', sendCommand, { id: 'openmd-document-new' }),
    commandItem('open', sendCommand),
    commandItem('open-workspace', sendCommand),
    commandItem('quick-open', sendCommand),
    {
      label: '最近打开',
      submenu: createRecentFilesSubmenu(recentFiles, sendCommand),
    },
    { type: 'separator' },
    commandItem('save', sendCommand, { id: 'openmd-document-save' }),
    commandItem('save-as', sendCommand),
    { type: 'separator' },
    commandItem('close-tab', sendCommand),
    commandItem('reopen-closed-tab', sendCommand),
    { type: 'separator' },
    commandItem('export-html', sendCommand),
    commandItem('export-pdf', sendCommand),
    commandItem('export-png', sendCommand),
    commandItem('export-repeat', sendCommand),
  ]

  if (isMac) {
    fileSubmenu.push(
      { type: 'separator' },
      { label: '关闭窗口', role: 'close', accelerator: 'Cmd+Shift+W' },
    )
  } else {
    fileSubmenu.push(
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    )
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              commandItem('open-settings', sendCommand),
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    { label: '文件', submenu: fileSubmenu },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
        { type: 'separator' },
        commandItem('find', sendCommand),
        commandItem('replace', sendCommand),
        commandItem('search-workspace', sendCommand),
      ],
    },
    {
      label: '视图',
      submenu: [
        commandItem('toggle-editor-mode', sendCommand, { id: 'openmd-toggle-editor-mode' }),
        commandItem('toggle-source-line-numbers', sendCommand),
        commandItem('toggle-source-line-wrapping', sendCommand),
        { type: 'separator' },
        commandItem('toggle-focus-mode', sendCommand, { type: 'checkbox' }),
        commandItem('toggle-typewriter-mode', sendCommand, { type: 'checkbox' }),
        { type: 'separator' },
        commandItem('next-tab', sendCommand),
        commandItem('previous-tab', sendCommand),
        { type: 'separator' },
        commandItem('reload', sendCommand),
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' as const }] : []),
  ]

  if (!isMac) {
    fileSubmenu.splice(fileSubmenu.length - 2, 0, commandItem('open-settings', sendCommand), {
      type: 'separator',
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  updateApplicationMenuCommandState(currentCommandState)
}
