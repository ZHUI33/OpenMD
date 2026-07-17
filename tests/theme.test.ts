import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { UserThemeService } from '../src/main/user-theme-service'
import { scopeUserThemeCss } from '../src/renderer/src/settings/theme-controller'
import {
  extractUserThemeMetadata,
  THEME_VARIABLE_NAMES,
  validateUserThemeCss,
} from '../src/shared/theme'

const THEME_CSS_PATH = join(process.cwd(), 'src', 'renderer', 'src', 'styles', 'theme.css')

function extractBlock(css: string, selector: string): string {
  const selectorIndex = css.indexOf(selector)
  if (selectorIndex < 0) return ''
  const start = css.indexOf('{', selectorIndex)
  if (start < 0) return ''
  let depth = 0
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start + 1, index)
    }
  }
  return ''
}

describe('built-in theme variables', () => {
  it('defines every semantic variable for both explicit light and dark themes', async () => {
    const css = await readFile(THEME_CSS_PATH, 'utf8')
    const lightBlock = extractBlock(css, ":root[data-theme='light']")
    const darkBlock = extractBlock(css, ":root[data-theme='dark']")

    expect(lightBlock).not.toBe('')
    expect(darkBlock).not.toBe('')
    for (const variable of THEME_VARIABLE_NAMES) {
      expect(lightBlock, `light theme is missing --${variable}`).toContain(`--${variable}:`)
      expect(darkBlock, `dark theme is missing --${variable}`).toContain(`--${variable}:`)
    }
  })
})

describe('user theme validation', () => {
  it('accepts variable-only UTF-8 themes and reads optional metadata', () => {
    const css = `
      /* @openmd-theme-name Paper Night
         @openmd-theme-appearance dark */
      :root {
        --background: #17181a;
        --foreground: rgb(240 240 236);
        --surface: color-mix(in srgb, #17181a 80%, white);
      }
    `

    expect(validateUserThemeCss(css)).toBe(true)
    expect(extractUserThemeMetadata(css, 'fallback')).toEqual({
      name: 'Paper Night',
      appearance: 'dark',
    })
  })

  it.each([
    ':root { color: red; }',
    '@import "https://example.com/theme.css"; :root { --background: red; }',
    ':root { --background: url(https://example.com/a.png); }',
    ':root { --background: red; } body { --foreground: black; }',
    ':root { --background: expression(alert(1)); }',
  ])('rejects unsafe or non-variable CSS: %s', (css) => {
    expect(validateUserThemeCss(css)).toBe(false)
  })

  it('scopes injected variables above the built-in theme selector specificity', () => {
    const scoped = scopeUserThemeCss(":root, :root[data-theme='dark'] { --background: #000; }")

    expect(scoped).toBe(
      ":root[data-user-theme], :root[data-user-theme][data-theme='dark'] { --background: #000; }",
    )
  })
})

describe('user theme directory', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('lists and loads only valid regular CSS theme files', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-themes-'))
    temporaryDirectories.push(temporaryDirectory)
    const validCss = `
      /* @openmd-theme-name Ocean */
      :root { --background: #001b2b; --foreground: #e7f6ff; }
    `
    await writeFile(join(temporaryDirectory, 'ocean.css'), validCss, 'utf8')
    await writeFile(join(temporaryDirectory, 'unsafe.css'), '@import "remote.css";', 'utf8')
    await writeFile(join(temporaryDirectory, 'not-css.js'), 'alert(1)', 'utf8')
    const service = new UserThemeService(temporaryDirectory)

    await expect(service.listThemes()).resolves.toEqual([
      {
        id: 'user:ocean.css',
        fileName: 'ocean.css',
        name: 'Ocean',
        appearance: 'light',
      },
    ])
    await expect(service.loadTheme('user:ocean.css')).resolves.toMatchObject({
      id: 'user:ocean.css',
      css: validCss,
    })
  })

  it('rejects traversal-shaped user theme identifiers', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-themes-'))
    temporaryDirectories.push(temporaryDirectory)
    const service = new UserThemeService(temporaryDirectory)

    await expect(service.loadTheme('user:../outside.css')).rejects.toThrow(
      'Invalid user theme identifier',
    )
  })
})
