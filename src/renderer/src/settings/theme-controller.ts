import type { AppSettings, BuiltInTheme } from '../../../shared/settings'
import { BUILT_IN_THEMES } from '../../../shared/settings'
import type { LoadedUserTheme } from '../../../shared/theme'
import type { RendererSettingsApi } from './settings-api'

export const USER_THEME_STYLE_ID = 'openmd-user-theme'

export function scopeUserThemeCss(css: string): string {
  return css.replace(/:root(?=\s*(?:\[|,|\{))/gu, ':root[data-user-theme]')
}

export function resolveBuiltInTheme(
  theme: BuiltInTheme,
  systemPrefersDark: boolean,
): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark ? 'dark' : 'light'
  return theme
}

function isBuiltInTheme(theme: AppSettings['theme']): theme is BuiltInTheme {
  return BUILT_IN_THEMES.some((candidate) => candidate === theme)
}

export function applyEditorSettings(
  settings: Readonly<AppSettings>,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty('--editor-font-family', settings.editorFontFamily)
  root.style.setProperty('--editor-font-size', `${settings.editorFontSizePx}px`)
  root.style.setProperty('--editor-line-height', String(settings.editorLineHeight))
  root.style.setProperty('--editor-max-width', `${settings.editorMaxWidthPx}px`)
}

export class ThemeController {
  private readonly colorSchemeQuery: MediaQueryList
  private currentSettings: AppSettings | undefined
  private disposed = false
  private requestGeneration = 0

  constructor(
    private readonly settingsApi: Pick<RendererSettingsApi, 'loadUserTheme'>,
    private readonly documentRef: Document = document,
    matchMedia: (query: string) => MediaQueryList = window.matchMedia.bind(window),
  ) {
    this.colorSchemeQuery = matchMedia('(prefers-color-scheme: dark)')
    this.colorSchemeQuery.addEventListener('change', this.handleSystemThemeChange)
  }

  async apply(settings: AppSettings): Promise<LoadedUserTheme | undefined> {
    if (this.disposed) return undefined
    this.currentSettings = { ...settings }
    applyEditorSettings(settings, this.documentRef.documentElement)
    const generation = ++this.requestGeneration

    if (isBuiltInTheme(settings.theme)) {
      this.removeUserThemeStyle()
      this.applyAppearance(resolveBuiltInTheme(settings.theme, this.colorSchemeQuery.matches))
      return undefined
    }

    this.removeUserThemeStyle()
    this.applyAppearance(this.colorSchemeQuery.matches ? 'dark' : 'light')
    const loadedTheme = await this.settingsApi.loadUserTheme(settings.theme)
    if (this.disposed || generation !== this.requestGeneration) return undefined

    let styleElement = this.documentRef.getElementById(
      USER_THEME_STYLE_ID,
    ) as HTMLStyleElement | null
    if (!styleElement) {
      styleElement = this.documentRef.createElement('style')
      styleElement.id = USER_THEME_STYLE_ID
      this.documentRef.head.append(styleElement)
    }
    // textContent cannot create markup, and the main process accepts only custom
    // property declarations from a validated local .css file.
    styleElement.textContent = scopeUserThemeCss(loadedTheme.css)
    this.documentRef.documentElement.dataset.userTheme = loadedTheme.id
    this.applyAppearance(loadedTheme.appearance)
    return loadedTheme
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.requestGeneration += 1
    this.colorSchemeQuery.removeEventListener('change', this.handleSystemThemeChange)
    this.removeUserThemeStyle()
  }

  private readonly handleSystemThemeChange = (): void => {
    const settings = this.currentSettings
    if (!settings || settings.theme !== 'system') return
    this.applyAppearance(resolveBuiltInTheme('system', this.colorSchemeQuery.matches))
  }

  private applyAppearance(appearance: 'light' | 'dark'): void {
    const root = this.documentRef.documentElement
    root.dataset.theme = appearance
    root.style.colorScheme = appearance
  }

  private removeUserThemeStyle(): void {
    this.documentRef.getElementById(USER_THEME_STYLE_ID)?.remove()
    delete this.documentRef.documentElement.dataset.userTheme
  }
}

let applicationThemeController: ThemeController | undefined

export function getApplicationThemeController(
  settingsApi: Pick<RendererSettingsApi, 'loadUserTheme'>,
): ThemeController {
  applicationThemeController ??= new ThemeController(settingsApi)
  return applicationThemeController
}
