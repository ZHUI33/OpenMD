import { ipcRenderer } from 'electron'

import type { AppInfo, DesktopApi } from '../shared/desktop-api.types'
import { IPC_CHANNELS } from '../shared/ipc-channels'

export const desktopApi: DesktopApi = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo) as Promise<AppInfo>,
})
