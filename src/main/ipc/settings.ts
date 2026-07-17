import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type { SettingsService } from '../settings-service'
import type { UserThemeService } from '../user-theme-service'

/** Kept local so this module can be integrated without editing the central IPC table. */
export const SETTINGS_IPC_CHANNELS = Object.freeze({
  get: 'openmd:settings:get',
  update: 'openmd:settings:update',
  reset: 'openmd:settings:reset',
  listUserThemes: 'openmd:themes:list',
  loadUserTheme: 'openmd:themes:load',
})

export type AuthorizeSettingsIpc = (event: IpcMainInvokeEvent) => unknown

export function registerSettingsIpcHandlers(
  settings: Pick<SettingsService, 'getSettings' | 'updateSettings' | 'resetSettings'>,
  themes: Pick<UserThemeService, 'listThemes' | 'loadTheme'>,
  authorize: AuthorizeSettingsIpc,
): () => void {
  const channels = Object.values(SETTINGS_IPC_CHANNELS)
  for (const channel of channels) ipcMain.removeHandler(channel)

  ipcMain.handle(SETTINGS_IPC_CHANNELS.get, (event) => {
    authorize(event)
    return settings.getSettings()
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.update, (event, value: unknown) => {
    authorize(event)
    return settings.updateSettings(value)
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.reset, (event) => {
    authorize(event)
    return settings.resetSettings()
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.listUserThemes, (event) => {
    authorize(event)
    return themes.listThemes()
  })
  ipcMain.handle(SETTINGS_IPC_CHANNELS.loadUserTheme, (event, value: unknown) => {
    authorize(event)
    return themes.loadTheme(value)
  })

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
