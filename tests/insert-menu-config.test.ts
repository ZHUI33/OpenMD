import { describe, expect, it } from 'vitest'

import {
  OPEN_MD_INSERT_COMMANDS,
  openMdInsertMenuConfig,
} from '../src/renderer/src/editor/insert-menu-config'

describe('OpenMD insert menu', () => {
  it('contains every required insertion command', () => {
    expect(OPEN_MD_INSERT_COMMANDS).toEqual([
      'heading',
      'quote',
      'bullet-list',
      'ordered-list',
      'task-list',
      'table',
      'code-block',
      'math',
      'divider',
    ])
  })

  it('keeps the image command hidden and exposes the phase 6 math command', () => {
    expect(openMdInsertMenuConfig.advancedGroup?.image).toBeNull()
    expect(openMdInsertMenuConfig.advancedGroup?.math).toEqual({ label: '公式' })
  })
})
