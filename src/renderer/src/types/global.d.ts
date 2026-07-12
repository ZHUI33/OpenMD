import type { OpenMdApi } from '../../../shared/desktop-api.types'

declare global {
  interface Window {
    openmd: OpenMdApi
  }
}

export {}
