import type { DesktopApi } from '../../../shared/desktop-api.types'

declare global {
  interface Window {
    desktop: DesktopApi
  }
}

export {}
