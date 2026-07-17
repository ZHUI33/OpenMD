import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { basename, extname, join, parse } from 'node:path'

import { isThemeSelection } from '../shared/settings'
import type { UserThemeId } from '../shared/settings'
import {
  extractUserThemeMetadata,
  MAX_USER_THEME_BYTES,
  validateUserThemeCss,
} from '../shared/theme'
import type { LoadedUserTheme, UserThemeInfo } from '../shared/theme'

export const MAX_USER_THEME_COUNT = 100

function compareThemeNames(left: UserThemeInfo, right: UserThemeInfo): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

export class UserThemeService {
  constructor(private readonly themeDirectoryPath: string) {}

  get directoryPath(): string {
    return this.themeDirectoryPath
  }

  async listThemes(): Promise<UserThemeInfo[]> {
    await mkdir(this.themeDirectoryPath, { recursive: true })
    const entries = await readdir(this.themeDirectoryPath, { withFileTypes: true })
    const cssFileNames = entries
      .filter(
        (entry) => entry.isFile() && extname(entry.name).toLocaleLowerCase('en-US') === '.css',
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
      .slice(0, MAX_USER_THEME_COUNT)

    const themes = await Promise.all(
      cssFileNames.map(async (fileName) => {
        try {
          const theme = await this.readThemeFile(fileName)
          return {
            id: theme.id,
            fileName: theme.fileName,
            name: theme.name,
            appearance: theme.appearance,
          }
        } catch {
          return undefined
        }
      }),
    )

    return themes
      .filter((theme): theme is UserThemeInfo => theme !== undefined)
      .sort(compareThemeNames)
  }

  async loadTheme(value: unknown): Promise<LoadedUserTheme> {
    if (!isThemeSelection(value) || !value.startsWith('user:')) {
      throw new TypeError('Invalid user theme identifier.')
    }
    return this.readThemeFile(value.slice('user:'.length))
  }

  private async readThemeFile(fileName: string): Promise<LoadedUserTheme> {
    if (
      basename(fileName) !== fileName ||
      fileName.length > 128 ||
      extname(fileName).toLocaleLowerCase('en-US') !== '.css'
    ) {
      throw new TypeError('Invalid user theme file name.')
    }

    const filePath = join(this.themeDirectoryPath, fileName)
    const fileStats = await lstat(filePath)
    if (
      !fileStats.isFile() ||
      fileStats.isSymbolicLink() ||
      fileStats.size > MAX_USER_THEME_BYTES
    ) {
      throw new TypeError('User theme must be a regular CSS file no larger than 256 KiB.')
    }

    const bytes = await readFile(filePath)
    let css: string
    try {
      css = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new TypeError('User theme must be valid UTF-8.')
    }
    if (!validateUserThemeCss(css)) throw new TypeError('Invalid or unsafe user theme CSS.')

    const fallbackName = parse(fileName).name
    const metadata = extractUserThemeMetadata(css, fallbackName)
    return {
      id: `user:${fileName}` as UserThemeId,
      fileName,
      name: metadata.name ?? fallbackName,
      appearance: metadata.appearance,
      css,
    }
  }
}
