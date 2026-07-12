import { describe, expect, it } from 'vitest'

import { formatDocumentTitle, getFileNameFromPath } from '../src/shared/document-utils'

describe('document utilities', () => {
  it('extracts file names from Windows and POSIX paths', () => {
    expect(getFileNameFromPath('C:\\writing\\README.md')).toBe('README.md')
    expect(getFileNameFromPath('/Users/openmd/notes/release.notes.markdown')).toBe(
      'release.notes.markdown',
    )
    expect(getFileNameFromPath(undefined)).toBeUndefined()
  })

  it.each([
    [undefined, false, '未命名 - OpenMD'],
    [undefined, true, '● 未命名 - OpenMD'],
    ['/notes/README.md', false, 'README.md - OpenMD'],
    ['/notes/README.md', true, '● README.md - OpenMD'],
  ] as const)('formats the document title for path %s and dirty=%s', (filePath, dirty, title) => {
    expect(formatDocumentTitle(filePath, dirty)).toBe(title)
  })
})
