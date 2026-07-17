import { beforeEach, describe, expect, it } from 'vitest'

import {
  normalizeEditorTabPath,
  resetEditorTabsStore,
  useEditorTabsStore,
} from '../src/renderer/src/stores/editor-tabs-store'

function openTab(id: string, filePath = `C:\\notes\\${id}.md`): void {
  useEditorTabsStore.getState().openTab({
    id,
    filePath,
    title: `${id}.md`,
    markdown: `# ${id}`,
    editorMode: 'visual',
  })
}

describe('editor tabs store', () => {
  beforeEach(resetEditorTabsStore)

  it('normalizes Windows path separators, case, dot segments, and trailing separators', () => {
    expect(normalizeEditorTabPath('C:\\Notes\\draft\\..\\Draft.md')).toBe(
      normalizeEditorTabPath('c:/notes/Draft.md/'),
    )
  })

  it('deduplicates a file path and activates the existing tab without replacing its state', () => {
    const first = useEditorTabsStore.getState().openTab({
      id: 'first',
      filePath: 'C:\\Notes\\Draft.md',
      title: 'Draft.md',
      markdown: 'original',
      editorMode: 'source',
    })
    const duplicate = useEditorTabsStore.getState().openTab({
      id: 'duplicate',
      filePath: 'c:/notes/draft.md',
      title: 'other title',
      markdown: 'replacement',
      editorMode: 'visual',
    })

    expect(first).toEqual({ tabId: 'first', opened: true })
    expect(duplicate).toEqual({ tabId: 'first', opened: false })
    expect(useEditorTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: 'first',
        markdown: 'original',
        editorMode: 'source',
      }),
    ])
    expect(useEditorTabsStore.getState().activeTabId).toBe('first')
  })

  it('keeps dirty content, editor mode, and scroll position isolated per tab', () => {
    openTab('one')
    openTab('two')

    const actions = useEditorTabsStore.getState()
    actions.updateTabMarkdown('one', 'changed')
    actions.setTabEditorMode('one', 'source')
    actions.setTabScrollPosition('one', 420)

    expect(useEditorTabsStore.getState().tabs).toEqual([
      expect.objectContaining({
        id: 'one',
        markdown: 'changed',
        dirty: true,
        editorMode: 'source',
        scrollPosition: 420,
      }),
      expect.objectContaining({
        id: 'two',
        markdown: '# two',
        dirty: false,
        editorMode: 'visual',
        scrollPosition: undefined,
      }),
    ])
  })

  it('keeps later edits dirty when an earlier save snapshot completes', () => {
    openTab('one')
    const actions = useEditorTabsStore.getState()
    actions.updateTabMarkdown('one', 'submitted snapshot')
    actions.updateTabMarkdown('one', 'edited while saving')

    expect(actions.markTabSaved('one', { markdown: 'submitted snapshot' })).toEqual({
      saved: true,
    })
    expect(useEditorTabsStore.getState().tabs[0]).toMatchObject({
      markdown: 'edited while saving',
      dirty: true,
    })

    useEditorTabsStore.getState().updateTabMarkdown('one', 'submitted snapshot')
    expect(useEditorTabsStore.getState().tabs[0]?.dirty).toBe(false)
  })

  it('requires confirmation before closing a dirty tab and closes it after discard', () => {
    openTab('one')
    openTab('two')
    useEditorTabsStore.getState().updateTabMarkdown('two', 'unsaved')

    const requested = useEditorTabsStore.getState().closeTabs('current')

    expect(requested).toMatchObject({
      status: 'confirmation-required',
      requiresConfirmation: true,
      dirtyTabIds: ['two'],
      closedTabIds: [],
    })
    expect(useEditorTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(['one', 'two'])

    const confirmed = useEditorTabsStore.getState().closeTabs('current', { discardDirty: true })
    expect(confirmed).toMatchObject({
      status: 'closed',
      closedTabIds: ['two'],
      activeTabId: 'one',
    })
    expect(useEditorTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(['one'])
  })

  it('can close an arbitrary tab through the current scope anchor', () => {
    openTab('one')
    openTab('two')
    openTab('three')

    const result = useEditorTabsStore.getState().closeTabs('current', { anchorTabId: 'one' })

    expect(result).toMatchObject({ status: 'closed', closedTabIds: ['one'] })
    expect(useEditorTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(['two', 'three'])
    expect(useEditorTabsStore.getState().activeTabId).toBe('three')
  })

  it('treats close-others atomically when any candidate is dirty', () => {
    openTab('one')
    openTab('two')
    openTab('three')
    useEditorTabsStore.getState().updateTabMarkdown('three', 'unsaved')

    expect(
      useEditorTabsStore
        .getState()
        .getCloseCandidates('others', 'two')
        .map((tab) => tab.id),
    ).toEqual(['one', 'three'])

    const requested = useEditorTabsStore.getState().closeTabs('others', { anchorTabId: 'two' })
    expect(requested).toMatchObject({
      status: 'confirmation-required',
      dirtyTabIds: ['three'],
      closedTabIds: [],
    })
    expect(useEditorTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(['one', 'two', 'three'])

    useEditorTabsStore.getState().closeTabs('others', { anchorTabId: 'two', discardDirty: true })
    expect(useEditorTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(['two'])
    expect(useEditorTabsStore.getState().activeTabId).toBe('two')
  })

  it('closes tabs to the right while retaining the anchor and current tab when possible', () => {
    openTab('one')
    openTab('two')
    openTab('three')
    openTab('four')
    useEditorTabsStore.getState().activateTab('two')

    const result = useEditorTabsStore.getState().closeTabs('right', { anchorTabId: 'two' })

    expect(result).toMatchObject({
      status: 'closed',
      closedTabIds: ['three', 'four'],
      activeTabId: 'two',
    })
    expect(useEditorTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(['one', 'two'])
  })

  it('prevents assigning a path that is already open to another tab', () => {
    openTab('one')
    useEditorTabsStore.getState().createUntitledTab({ title: 'new' })
    const untitledId = useEditorTabsStore.getState().activeTabId

    expect(untitledId).toBeDefined()
    expect(
      useEditorTabsStore.getState().updateTabFilePath(untitledId!, 'c:/NOTES/one.md', 'one.md'),
    ).toBe(false)
    expect(useEditorTabsStore.getState().tabs.at(-1)?.filePath).toBeUndefined()
  })
})
