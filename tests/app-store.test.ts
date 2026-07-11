import { beforeEach, describe, expect, it } from 'vitest'

import {
  WELCOME_MARKDOWN,
  countCharacters,
  countWords,
  useAppStore,
} from '../src/renderer/src/stores/app-store'

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: 'system',
      sidebarVisible: false,
      document: {
        markdown: WELCOME_MARKDOWN,
        dirty: false,
        wordCount: countWords(WELCOME_MARKDOWN),
        characterCount: countCharacters(WELCOME_MARKDOWN),
      },
    })
  })

  it('uses the required initial application state', () => {
    const state = useAppStore.getState()

    expect(state.theme).toBe('system')
    expect(state.sidebarVisible).toBe(false)
    expect(state.document.markdown).toBe(WELCOME_MARKDOWN)
    expect(state.document.dirty).toBe(false)
  })

  it('updates the theme', () => {
    useAppStore.getState().setTheme('dark')

    expect(useAppStore.getState().theme).toBe('dark')
  })

  it('toggles sidebar visibility', () => {
    useAppStore.getState().toggleSidebar()

    expect(useAppStore.getState().sidebarVisible).toBe(true)
  })

  it('counts Chinese characters and English words', () => {
    expect(countWords('你好 OpenMD editor 2026')).toBe(5)
  })

  it('counts Unicode characters rather than UTF-16 code units', () => {
    expect(countCharacters('OpenMD 中文 🚀')).toBe(11)
  })

  it('updates document statistics and dirty state', () => {
    useAppStore.getState().updateMarkdown('# 新文档\n\nHello world')

    const document = useAppStore.getState().document
    expect(document.markdown).toBe('# 新文档\n\nHello world')
    expect(document.dirty).toBe(true)
    expect(document.wordCount).toBe(5)
    expect(document.characterCount).toBe(18)
  })

  it('initializes a loaded Markdown document as clean', () => {
    useAppStore.getState().setDocument('## Initial Markdown')

    expect(useAppStore.getState().document).toEqual({
      markdown: '## Initial Markdown',
      dirty: false,
      wordCount: 2,
      characterCount: 19,
    })
  })
})
