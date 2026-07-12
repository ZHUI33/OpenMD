import { describe, expect, it } from 'vitest'

import {
  OPENMD_CODE_LANGUAGE_IDS,
  openMdCodeLanguages,
} from '../src/renderer/src/editor/code-block-config'

describe('CodeMirror code-block configuration', () => {
  it('offers exactly the required canonical Markdown language identifiers', () => {
    expect(openMdCodeLanguages.map(({ name }) => name)).toEqual(OPENMD_CODE_LANGUAGE_IDS)
  })

  it.each([
    ['javascript', 'js'],
    ['typescript', 'ts'],
    ['bash', 'sh'],
    ['html', 'xhtml'],
    ['plaintext', 'txt'],
  ] as const)('keeps common aliases for %s', (language, alias) => {
    const description = openMdCodeLanguages.find(({ name }) => name === language)

    expect(description?.alias).toContain(alias)
  })

  it('loads valid language support for highlighting, including plaintext', async () => {
    const supports = await Promise.all(openMdCodeLanguages.map((language) => language.load()))

    expect(supports).toHaveLength(OPENMD_CODE_LANGUAGE_IDS.length)
    supports.forEach((support) => expect(support).toBeDefined())
  })
})
