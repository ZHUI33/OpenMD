import { app, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import type { RecentFile, RendererCommand } from '../shared/desktop-api.types'

export type SendDocumentCommand = (command: RendererCommand) => void

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
    {
      id: 'openmd-document-new',
      label: '新建',
      accelerator: 'CmdOrCtrl+N',
      click: () => sendCommand({ type: 'new' }),
    },
    {
      label: '打开…',
      accelerator: 'CmdOrCtrl+O',
      click: () => sendCommand({ type: 'open' }),
    },
    {
      label: '打开文件夹工作区…',
      accelerator: 'CmdOrCtrl+Shift+O',
      click: () => sendCommand({ type: 'open-workspace' }),
    },
    {
      label: '最近打开',
      submenu: createRecentFilesSubmenu(recentFiles, sendCommand),
    },
    { type: 'separator' },
    {
      id: 'openmd-document-save',
      label: '保存',
      accelerator: 'CmdOrCtrl+S',
      click: () => sendCommand({ type: 'save' }),
    },
    {
      label: '另存为…',
      accelerator: 'CmdOrCtrl+Shift+S',
      click: () => sendCommand({ type: 'save-as' }),
    },
    { type: 'separator' },
    {
      label: '导出 HTML…',
      accelerator: 'CmdOrCtrl+Alt+H',
      click: () => sendCommand({ type: 'export-html' }),
    },
    {
      label: '导出 PDF…',
      accelerator: 'CmdOrCtrl+Alt+P',
      click: () => sendCommand({ type: 'export-pdf' }),
    },
  ]

  if (isMac) {
    fileSubmenu.push({ type: 'separator' }, { label: '关闭窗口', role: 'close' })
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
        {
          label: '在工作区中搜索',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => sendCommand({ type: 'search-workspace' }),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          id: 'openmd-toggle-editor-mode',
          label: '切换编辑模式',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendCommand({ type: 'toggle-editor-mode' }),
        },
        {
          label: '切换源码行号',
          click: () => sendCommand({ type: 'toggle-source-line-numbers' }),
        },
        {
          label: '切换长行自动换行',
          click: () => sendCommand({ type: 'toggle-source-line-wrapping' }),
        },
        { type: 'separator' },
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendCommand({ type: 'reload' }),
        },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' as const }] : []),
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
