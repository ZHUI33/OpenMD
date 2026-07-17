export const SETTINGS_SCHEMA_VERSION = 2

export const BUILT_IN_THEMES = ['system', 'light', 'dark'] as const
export const EDITOR_MODES = ['visual', 'source'] as const
export const IMAGE_ASSET_DIRECTORY_RULES = [
  'document-name',
  'assets',
  'workspace-assets',
  'custom',
] as const

export type BuiltInTheme = (typeof BUILT_IN_THEMES)[number]
export type UserThemeId = `user:${string}`
export type ThemeSelection = BuiltInTheme | UserThemeId
export type DefaultEditorMode = (typeof EDITOR_MODES)[number]
export type ImageAssetDirectoryRule = (typeof IMAGE_ASSET_DIRECTORY_RULES)[number]

export interface AppSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION
  theme: ThemeSelection
  defaultEditorMode: DefaultEditorMode
  autoSave: boolean
  autoSaveDelayMs: number
  editorFontFamily: string
  editorFontSizePx: number
  editorLineHeight: number
  editorMaxWidthPx: number
  sourceLineNumbers: boolean
  sourceLineWrapping: boolean
  imageAssetDirectoryRule: ImageAssetDirectoryRule
  customImageAssetDirectory: string
  showTextFiles: boolean
}

export type AppSettingsUpdate = Partial<Omit<AppSettings, 'schemaVersion'>>

export const SETTINGS_LIMITS = Object.freeze({
  autoSaveDelayMs: Object.freeze({ min: 250, max: 60_000 }),
  editorFontSizePx: Object.freeze({ min: 10, max: 48 }),
  editorLineHeight: Object.freeze({ min: 1, max: 3 }),
  editorMaxWidthPx: Object.freeze({ min: 480, max: 2_400 }),
})

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  theme: 'system',
  defaultEditorMode: 'visual',
  autoSave: false,
  autoSaveDelayMs: 1_200,
  editorFontFamily:
    "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  editorFontSizePx: 17,
  editorLineHeight: 1.7,
  editorMaxWidthPx: 860,
  sourceLineNumbers: true,
  sourceLineWrapping: true,
  imageAssetDirectoryRule: 'document-name',
  customImageAssetDirectory: 'assets',
  showTextFiles: false,
})

const SETTINGS_KEYS = new Set<string>([
  'theme',
  'defaultEditorMode',
  'autoSave',
  'autoSaveDelayMs',
  'editorFontFamily',
  'editorFontSizePx',
  'editorLineHeight',
  'editorMaxWidthPx',
  'sourceLineNumbers',
  'sourceLineWrapping',
  'imageAssetDirectoryRule',
  'customImageAssetDirectory',
  'showTextFiles',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}

export function isThemeSelection(value: unknown): value is ThemeSelection {
  if (isOneOf(value, BUILT_IN_THEMES)) return true
  if (typeof value !== 'string' || !value.startsWith('user:')) return false

  const fileName = value.slice('user:'.length)
  return (
    fileName.length > 4 &&
    fileName.length <= 128 &&
    fileName.toLocaleLowerCase('en-US').endsWith('.css') &&
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    fileName !== '.' &&
    fileName !== '..' &&
    !fileName.includes('\0')
  )
}

function clampNumber(
  value: unknown,
  fallback: number,
  limits: Readonly<{ min: number; max: number }>,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(limits.max, Math.max(limits.min, value))
}

function safeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  const hasUnsafeCharacter = Array.from(trimmed).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || character === '{' || character === '}' || character === ';'
  })
  if (!trimmed || trimmed.length > 160 || hasUnsafeCharacter) return fallback
  return trimmed
}

export function normalizeRelativeAssetDirectory(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (
    !normalized ||
    normalized.length > 160 ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '..')
  ) {
    return fallback
  }
  return normalized
}

function legacyTheme(value: unknown): ThemeSelection {
  if (isThemeSelection(value)) return value
  if (value === 'OpenMD Light' || value === 'openmd-light') return 'light'
  if (value === 'OpenMD Dark' || value === 'openmd-dark') return 'dark'
  if (value === 'follow-system') return 'system'
  return DEFAULT_SETTINGS.theme
}

/**
 * Converts persisted settings from every supported schema into the current schema.
 * Invalid values are repaired independently so one corrupt field does not discard
 * the rest of the user's preferences.
 */
export function migrateSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS }

  const source = isRecord(value.settings) ? { ...value, ...value.settings } : value
  const defaultEditorModeValue = source.defaultEditorMode ?? source.editorMode
  const autoSaveValue = source.autoSave ?? source.autoSaveEnabled
  const autoSaveDelayValue = source.autoSaveDelayMs ?? source.autoSaveDelay
  const fontFamilyValue = source.editorFontFamily ?? source.fontFamily ?? source.font
  const fontSizeValue = source.editorFontSizePx ?? source.fontSize
  const lineHeightValue = source.editorLineHeight ?? source.lineHeight
  const maxWidthValue = source.editorMaxWidthPx ?? source.editorMaxWidth
  const lineNumbersValue = source.sourceLineNumbers ?? source.sourceModeLineNumbers
  const lineWrappingValue = source.sourceLineWrapping ?? source.sourceModeLineWrapping
  const assetRuleValue = source.imageAssetDirectoryRule ?? source.imageResourceDirectoryRule
  const customAssetValue =
    source.customImageAssetDirectory ?? source.imageAssetDirectory ?? source.imageResourceDirectory

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    theme: legacyTheme(source.theme),
    defaultEditorMode: isOneOf(defaultEditorModeValue, EDITOR_MODES)
      ? defaultEditorModeValue
      : DEFAULT_SETTINGS.defaultEditorMode,
    autoSave: typeof autoSaveValue === 'boolean' ? autoSaveValue : DEFAULT_SETTINGS.autoSave,
    autoSaveDelayMs: clampNumber(
      autoSaveDelayValue,
      DEFAULT_SETTINGS.autoSaveDelayMs,
      SETTINGS_LIMITS.autoSaveDelayMs,
    ),
    editorFontFamily: safeFontFamily(fontFamilyValue, DEFAULT_SETTINGS.editorFontFamily),
    editorFontSizePx: clampNumber(
      fontSizeValue,
      DEFAULT_SETTINGS.editorFontSizePx,
      SETTINGS_LIMITS.editorFontSizePx,
    ),
    editorLineHeight: clampNumber(
      lineHeightValue,
      DEFAULT_SETTINGS.editorLineHeight,
      SETTINGS_LIMITS.editorLineHeight,
    ),
    editorMaxWidthPx: clampNumber(
      maxWidthValue,
      DEFAULT_SETTINGS.editorMaxWidthPx,
      SETTINGS_LIMITS.editorMaxWidthPx,
    ),
    sourceLineNumbers:
      typeof lineNumbersValue === 'boolean' ? lineNumbersValue : DEFAULT_SETTINGS.sourceLineNumbers,
    sourceLineWrapping:
      typeof lineWrappingValue === 'boolean'
        ? lineWrappingValue
        : DEFAULT_SETTINGS.sourceLineWrapping,
    imageAssetDirectoryRule: isOneOf(assetRuleValue, IMAGE_ASSET_DIRECTORY_RULES)
      ? assetRuleValue
      : DEFAULT_SETTINGS.imageAssetDirectoryRule,
    customImageAssetDirectory: normalizeRelativeAssetDirectory(
      customAssetValue,
      DEFAULT_SETTINGS.customImageAssetDirectory,
    ),
    showTextFiles:
      typeof source.showTextFiles === 'boolean'
        ? source.showTextFiles
        : DEFAULT_SETTINGS.showTextFiles,
  }
}

function assertNumberInRange(
  value: unknown,
  field: string,
  limits: Readonly<{ min: number; max: number }>,
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < limits.min ||
    value > limits.max
  ) {
    throw new TypeError(`${field} must be between ${limits.min} and ${limits.max}.`)
  }
}

/** Parses an untrusted IPC update payload and rejects unknown or malformed fields. */
export function parseSettingsUpdate(value: unknown): AppSettingsUpdate {
  if (!isRecord(value)) throw new TypeError('Invalid settings update.')

  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.has(key)) throw new TypeError(`Unknown settings field: ${key}`)
  }

  const update: AppSettingsUpdate = {}
  if ('theme' in value) {
    if (!isThemeSelection(value.theme)) throw new TypeError('Invalid theme selection.')
    update.theme = value.theme
  }
  if ('defaultEditorMode' in value) {
    if (!isOneOf(value.defaultEditorMode, EDITOR_MODES)) {
      throw new TypeError('Invalid default editor mode.')
    }
    update.defaultEditorMode = value.defaultEditorMode
  }
  for (const field of [
    'autoSave',
    'sourceLineNumbers',
    'sourceLineWrapping',
    'showTextFiles',
  ] as const) {
    if (field in value) {
      if (typeof value[field] !== 'boolean') throw new TypeError(`${field} must be a boolean.`)
      update[field] = value[field]
    }
  }
  if ('autoSaveDelayMs' in value) {
    assertNumberInRange(value.autoSaveDelayMs, 'autoSaveDelayMs', SETTINGS_LIMITS.autoSaveDelayMs)
    update.autoSaveDelayMs = value.autoSaveDelayMs
  }
  if ('editorFontSizePx' in value) {
    assertNumberInRange(
      value.editorFontSizePx,
      'editorFontSizePx',
      SETTINGS_LIMITS.editorFontSizePx,
    )
    update.editorFontSizePx = value.editorFontSizePx
  }
  if ('editorLineHeight' in value) {
    assertNumberInRange(
      value.editorLineHeight,
      'editorLineHeight',
      SETTINGS_LIMITS.editorLineHeight,
    )
    update.editorLineHeight = value.editorLineHeight
  }
  if ('editorMaxWidthPx' in value) {
    assertNumberInRange(
      value.editorMaxWidthPx,
      'editorMaxWidthPx',
      SETTINGS_LIMITS.editorMaxWidthPx,
    )
    update.editorMaxWidthPx = value.editorMaxWidthPx
  }
  if ('editorFontFamily' in value) {
    const fontFamily = safeFontFamily(value.editorFontFamily, '')
    if (!fontFamily) throw new TypeError('Invalid editor font family.')
    update.editorFontFamily = fontFamily
  }
  if ('imageAssetDirectoryRule' in value) {
    if (!isOneOf(value.imageAssetDirectoryRule, IMAGE_ASSET_DIRECTORY_RULES)) {
      throw new TypeError('Invalid image asset directory rule.')
    }
    update.imageAssetDirectoryRule = value.imageAssetDirectoryRule
  }
  if ('customImageAssetDirectory' in value) {
    const directory = normalizeRelativeAssetDirectory(value.customImageAssetDirectory)
    if (!directory) throw new TypeError('Invalid custom image asset directory.')
    update.customImageAssetDirectory = directory
  }

  return update
}

export function applySettingsUpdate(current: Readonly<AppSettings>, value: unknown): AppSettings {
  return { ...current, ...parseSettingsUpdate(value), schemaVersion: SETTINGS_SCHEMA_VERSION }
}
