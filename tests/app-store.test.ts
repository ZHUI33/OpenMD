import { beforeEach, describe, expect, it } from 'vitest'

import { useAppStore } from '../src/renderer/src/stores/app-store'

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: 'system',
      sidebarVisible: false,
    })
  })

  it('uses the required initial application state', () => {
    const state = useAppStore.getState()

    expect(state.theme).toBe('system')
    expect(state.sidebarVisible).toBe(false)
  })

  it('updates the theme', () => {
    useAppStore.getState().setTheme('dark')

    expect(useAppStore.getState().theme).toBe('dark')
  })

  it('toggles sidebar visibility', () => {
    useAppStore.getState().toggleSidebar()

    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })
})
