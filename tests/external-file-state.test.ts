import { describe, expect, it } from 'vitest'

import { resolveExternalFileChange } from '../src/renderer/src/external-file-state'

describe('external file state', () => {
  it('reloads an externally changed clean tab', () => {
    expect(resolveExternalFileChange({ type: 'changed' }, false)).toEqual({
      action: 'reload',
      status: 'clean',
    })
  })

  it('raises a conflict instead of overwriting a dirty tab', () => {
    expect(resolveExternalFileChange({ type: 'changed' }, true)).toEqual({
      action: 'show-conflict',
      status: 'conflict',
    })
  })

  it('preserves a distinct deleted state regardless of dirty state', () => {
    expect(resolveExternalFileChange({ type: 'deleted' }, false)).toEqual({
      action: 'show-deleted',
      status: 'deleted',
    })
    expect(resolveExternalFileChange({ type: 'deleted' }, true)).toEqual({
      action: 'show-deleted',
      status: 'deleted',
    })
  })
})
