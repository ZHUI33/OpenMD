import { SETTINGS_LIMITS } from '../../../shared/settings'

export function clampSidebarWidth(width: number): number {
  return Math.min(
    SETTINGS_LIMITS.sidebarWidthPx.max,
    Math.max(SETTINGS_LIMITS.sidebarWidthPx.min, Math.round(width)),
  )
}
