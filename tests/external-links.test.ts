import { describe, expect, it } from 'vitest'

import { parseOpenExternalUrlRequest } from '../src/main/ipc'

describe('external link IPC validation', () => {
  it('allows only system-safe external protocols', () => {
    expect(parseOpenExternalUrlRequest({ url: 'https://example.com/path' })).toEqual({
      url: 'https://example.com/path',
    })
    expect(parseOpenExternalUrlRequest({ url: 'mailto:hello@example.com' }).url).toBe(
      'mailto:hello@example.com',
    )
    expect(() => parseOpenExternalUrlRequest({ url: 'javascript:alert(1)' })).toThrow(/protocol/u)
    expect(() => parseOpenExternalUrlRequest({ url: 'file:///private/note.md' })).toThrow(
      /protocol/u,
    )
  })
})
