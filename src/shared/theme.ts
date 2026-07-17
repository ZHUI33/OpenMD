import type { UserThemeId } from './settings'

export const MAX_USER_THEME_BYTES = 256 * 1024

/** Every semantic token that both built-in themes must define. */
export const THEME_VARIABLE_NAMES = Object.freeze([
  'background',
  'foreground',
  'surface',
  'surface-subtle',
  'surface-elevated',
  'sidebar-background',
  'border',
  'border-strong',
  'primary',
  'primary-hover',
  'primary-contrast',
  'on-primary',
  'primary-soft',
  'danger',
  'danger-soft',
  'muted',
  'muted-subtle',
  'focus-ring',
  'syntax-marker',
  'inline-code-background',
  'inline-code-border',
  'inline-code-foreground',
  'source-background',
  'source-gutter-background',
  'source-gutter-foreground',
  'source-active-line',
  'source-selection',
  'source-search',
  'source-search-outline',
  'source-search-selected',
  'code-background',
  'code-surface',
  'code-foreground',
  'code-muted',
  'code-border',
  'code-selection',
  'table-header-background',
  'table-stripe-background',
  'tree-hover',
  'tree-selection',
  'tab-bar-background',
  'tab-inactive',
  'tab-active',
  'diff-background',
  'katex-foreground',
  'mermaid-background',
  'mermaid-foreground',
  'mermaid-muted',
  'mermaid-line',
  'mermaid-error',
  'dialog-backdrop',
  'shadow',
] as const)

export type ThemeVariableName = (typeof THEME_VARIABLE_NAMES)[number]
export type ThemeAppearance = 'light' | 'dark'

export interface UserThemeInfo {
  id: UserThemeId
  fileName: string
  name: string
  appearance: ThemeAppearance
}

export interface LoadedUserTheme extends UserThemeInfo {
  css: string
}

export interface UserThemeMetadata {
  name?: string
  appearance: ThemeAppearance
}

const SAFE_THEME_SELECTOR = /^:root(?:\[data-theme=(?:'light'|'dark'|"light"|"dark")\])?$/u
const CUSTOM_PROPERTY_NAME = /^--[a-z][a-z\d-]*$/u
const FORBIDDEN_CSS =
  /@(?:import|namespace|document|charset)|url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding\s*:|behavior\s*:|<\/?script\b/iu

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

function splitDeclarations(block: string): string[] | undefined {
  const declarations: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let parenthesisDepth = 0

  for (let index = 0; index < block.length; index += 1) {
    const character = block[index]
    if (quote) {
      current += character
      if (character === '\\') {
        const next = block[index + 1]
        if (next !== undefined) {
          current += next
          index += 1
        }
      } else if (character === quote) {
        quote = undefined
      }
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      current += character
    } else if (character === '(') {
      parenthesisDepth += 1
      current += character
    } else if (character === ')') {
      parenthesisDepth -= 1
      if (parenthesisDepth < 0) return undefined
      current += character
    } else if (character === ';' && parenthesisDepth === 0) {
      if (current.trim()) declarations.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }

  if (quote || parenthesisDepth !== 0) return undefined
  if (current.trim()) declarations.push(current.trim())
  return declarations
}

/**
 * User themes deliberately support only custom-property declarations in :root.
 * This makes the files useful for theming while preventing selectors, imports,
 * remote resources, or executable legacy CSS from reaching the renderer.
 */
export function validateUserThemeCss(css: string): boolean {
  if (
    !css ||
    new TextEncoder().encode(css).byteLength > MAX_USER_THEME_BYTES ||
    FORBIDDEN_CSS.test(css)
  ) {
    return false
  }

  const source = stripComments(css)
  const blockPattern = /([^{}]+)\{([^{}]*)\}/gu
  let cursor = 0
  let declarationCount = 0

  for (const match of source.matchAll(blockPattern)) {
    const matchIndex = match.index
    if (source.slice(cursor, matchIndex).trim()) return false

    const selectors = match[1].split(',').map((selector) => selector.trim())
    if (
      selectors.length === 0 ||
      selectors.some((selector) => !SAFE_THEME_SELECTOR.test(selector))
    ) {
      return false
    }

    const declarations = splitDeclarations(match[2])
    if (!declarations) return false
    for (const declaration of declarations) {
      const colonIndex = declaration.indexOf(':')
      if (colonIndex <= 0) return false
      const property = declaration.slice(0, colonIndex).trim()
      const value = declaration.slice(colonIndex + 1).trim()
      if (!CUSTOM_PROPERTY_NAME.test(property) || !value || /[{}\\]/u.test(value)) return false
      declarationCount += 1
    }
    cursor = matchIndex + match[0].length
  }

  return declarationCount > 0 && !source.slice(cursor).trim()
}

export function extractUserThemeMetadata(css: string, fallbackName: string): UserThemeMetadata {
  const nameMatch = css.match(/@openmd-theme-name\s+([^\r\n*]{1,80})/iu)
  const appearanceMatch = css.match(/@openmd-theme-appearance\s+(light|dark)\b/iu)
  const name = nameMatch?.[1].trim()
  return {
    name: name || fallbackName,
    appearance: appearanceMatch?.[1].toLocaleLowerCase('en-US') === 'dark' ? 'dark' : 'light',
  }
}
