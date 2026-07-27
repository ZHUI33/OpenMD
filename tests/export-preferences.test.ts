// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import {
  exportDocumentIdentity,
  loadExportConfiguration,
  saveExportConfiguration,
} from '../src/renderer/src/export-preferences'

describe('per-document export preferences', () => {
  it('normalizes Windows paths and stores only successful configurations per document', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const identity = exportDocumentIdentity('ignored', 'C:\\Notes\\Guide.md')
    expect(identity).toBe(exportDocumentIdentity('other', 'c:/notes/guide.md'))

    saveExportConfiguration(
      identity,
      {
        mode: 'html',
        title: 'Guide',
        imageStrategy: 'base64',
        style: 'unstyled',
      },
      storage,
    )
    expect(loadExportConfiguration(identity, storage)).toEqual({
      mode: 'html',
      title: 'Guide',
      imageStrategy: 'base64',
      style: 'unstyled',
    })
    expect(loadExportConfiguration(exportDocumentIdentity('new-tab'), storage)).toBeUndefined()
  })
})
