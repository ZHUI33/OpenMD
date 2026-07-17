import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SettingsService } from '../src/main/settings-service'
import {
  applySettingsUpdate,
  DEFAULT_SETTINGS,
  migrateSettings,
  SETTINGS_SCHEMA_VERSION,
} from '../src/shared/settings'

describe('settings defaults and migration', () => {
  it('returns an independent copy of complete defaults for missing data', () => {
    const settings = migrateSettings(undefined)

    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings).not.toBe(DEFAULT_SETTINGS)
    expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('migrates legacy field names and repairs individual invalid values', () => {
    const settings = migrateSettings({
      version: 1,
      theme: 'OpenMD Dark',
      editorMode: 'source',
      autoSaveEnabled: true,
      autoSaveDelay: 50,
      font: '  Iosevka, monospace  ',
      fontSize: 22,
      lineHeight: 1.9,
      editorMaxWidth: 1_120,
      sourceModeLineNumbers: false,
      sourceModeLineWrapping: false,
      imageResourceDirectoryRule: 'custom',
      imageResourceDirectory: 'media\\images',
      showTextFiles: true,
    })

    expect(settings).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      theme: 'dark',
      defaultEditorMode: 'source',
      autoSave: true,
      autoSaveDelayMs: 250,
      editorFontFamily: 'Iosevka, monospace',
      editorFontSizePx: 22,
      editorLineHeight: 1.9,
      editorMaxWidthPx: 1_120,
      sourceLineNumbers: false,
      sourceLineWrapping: false,
      imageAssetDirectoryRule: 'custom',
      customImageAssetDirectory: 'media/images',
      showTextFiles: true,
    })
  })

  it('rejects malformed updates and workspace-escaping asset directories', () => {
    expect(() => applySettingsUpdate(DEFAULT_SETTINGS, { unknown: true })).toThrow(
      'Unknown settings field',
    )
    expect(() =>
      applySettingsUpdate(DEFAULT_SETTINGS, { customImageAssetDirectory: '../outside' }),
    ).toThrow('Invalid custom image asset directory')
    expect(() => applySettingsUpdate(DEFAULT_SETTINGS, { editorFontSizePx: 2 })).toThrow(
      'editorFontSizePx',
    )
  })
})

describe('settings service persistence', () => {
  let temporaryDirectory: string
  let settingsPath: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-settings-'))
    settingsPath = join(temporaryDirectory, 'user-data', 'settings.json')
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('persists settings and reloads them from the user-data file', async () => {
    const service = new SettingsService(settingsPath)
    await service.updateSettings({
      theme: 'dark',
      defaultEditorMode: 'source',
      autoSave: true,
      autoSaveDelayMs: 900,
    })

    const reloaded = await new SettingsService(settingsPath).getSettings()
    expect(reloaded).toMatchObject({
      theme: 'dark',
      defaultEditorMode: 'source',
      autoSave: true,
      autoSaveDelayMs: 900,
    })
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(reloaded)
  })

  it('serializes concurrent field updates without losing either change', async () => {
    const service = new SettingsService(settingsPath)

    await Promise.all([
      service.updateSettings({ theme: 'light' }),
      service.updateSettings({ editorFontSizePx: 20 }),
    ])

    await expect(service.getSettings()).resolves.toMatchObject({
      theme: 'light',
      editorFontSizePx: 20,
    })
  })

  it('repairs malformed persisted JSON with current defaults', async () => {
    await writeFile(settingsPath, '{broken', 'utf8').catch(async () => {
      const service = new SettingsService(settingsPath)
      await service.resetSettings()
      await writeFile(settingsPath, '{broken', 'utf8')
    })

    const settings = await new SettingsService(settingsPath).getSettings()
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(DEFAULT_SETTINGS)
  })
})
