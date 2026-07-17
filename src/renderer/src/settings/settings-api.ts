import type { AppSettings, AppSettingsUpdate } from '../../../shared/settings'
import type { LoadedUserTheme, UserThemeInfo } from '../../../shared/theme'

export interface RendererSettingsApi {
  get: () => Promise<AppSettings>
  update: (update: AppSettingsUpdate) => Promise<AppSettings>
  reset: () => Promise<AppSettings>
  listUserThemes: () => Promise<UserThemeInfo[]>
  loadUserTheme: (themeId: string) => Promise<LoadedUserTheme>
}

interface WindowWithSettingsBridge {
  openmd?: {
    settings?: RendererSettingsApi
  }
}

export function getRendererSettingsApi(): RendererSettingsApi {
  const settings = (window as unknown as WindowWithSettingsBridge).openmd?.settings
  if (!settings) throw new Error('The settings bridge is not available.')
  return settings
}
