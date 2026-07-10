import { app, BrowserWindow, ipcMain } from 'electron'

import type { AppInfo } from '../../shared/desktop-api.types'
import { IPC_CHANNELS } from '../../shared/ipc-channels'

export function registerIpcHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.appGetInfo)
  ipcMain.handle(IPC_CHANNELS.appGetInfo, (event): AppInfo => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)

    if (!senderWindow || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Blocked IPC request from an untrusted renderer.')
    }

    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
    }
  })
}
