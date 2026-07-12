import { describe, expect, it } from 'vitest'

import {
  OPEN_MD_INSERT_COMMANDS,
  openMdInsertMenuConfig,
} from '../src/renderer/src/editor/insert-menu-config'

describe('phase 4 insert menu', () => {
  it('contains every required insertion command', () => {
    expect(OPEN_MD_INSERT_COMMANDS).toEqual([
      'heading',
      'quote',
      'bullet-list',
      'ordered-list',
      'task-list',
      'table',
      'code-block',
      'divider',
    ])
  })

  it('keeps out-of-scope image and math commands hidden', () => {
    expect(openMdInsertMenuConfig.advancedGroup?.image).toBeNull()
    expect(openMdInsertMenuConfig.advancedGroup?.math).toBeNull()
  })
})
