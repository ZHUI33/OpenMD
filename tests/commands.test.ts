import { describe, expect, it } from 'vitest'

import { APP_COMMANDS, displayAccelerator, eventMatchesCommand } from '../src/shared/commands'

function keyboard(
  key: string,
  options: Partial<{
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
  }> = {},
) {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...options,
  }
}

describe('shared application commands', () => {
  it('matches platform primary shortcuts while keeping Ctrl+Tab control-specific', () => {
    expect(eventMatchesCommand(keyboard('f', { ctrlKey: true }), APP_COMMANDS.find)).toBe(true)
    expect(eventMatchesCommand(keyboard('f', { metaKey: true }), APP_COMMANDS.find)).toBe(true)
    expect(eventMatchesCommand(keyboard('Tab', { ctrlKey: true }), APP_COMMANDS['next-tab'])).toBe(
      true,
    )
    expect(eventMatchesCommand(keyboard('Tab', { metaKey: true }), APP_COMMANDS['next-tab'])).toBe(
      false,
    )
  })

  it('formats Windows and macOS shortcut labels from the same definition', () => {
    expect(displayAccelerator(APP_COMMANDS['open-settings'], 'win32')).toBe('Ctrl+,')
    expect(displayAccelerator(APP_COMMANDS['open-settings'], 'darwin')).toBe('⌘,')
    expect(displayAccelerator(APP_COMMANDS['previous-tab'], 'darwin')).toBe('⌃⇧Tab')
  })
})
