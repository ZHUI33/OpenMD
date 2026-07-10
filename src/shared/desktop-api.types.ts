export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface DesktopApi {
  getAppInfo: () => Promise<AppInfo>
}
