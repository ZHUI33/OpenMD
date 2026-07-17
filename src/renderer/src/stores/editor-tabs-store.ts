import { create } from 'zustand'

export interface EditorTab {
  id: string
  filePath?: string
  title: string
  markdown: string
  dirty: boolean
  editorMode: 'visual' | 'source'
  scrollPosition?: number
}

export type CloseTabsScope = 'current' | 'others' | 'right'

export interface OpenEditorTabInput {
  id?: string
  filePath?: string
  title: string
  markdown: string
  dirty?: boolean
  editorMode?: EditorTab['editorMode']
  scrollPosition?: number
}

export interface CreateUntitledTabOptions {
  title?: string
  markdown?: string
  editorMode?: EditorTab['editorMode']
  scrollPosition?: number
}

export interface OpenTabResult {
  tabId: string
  opened: boolean
}

export interface CloseTabsOptions {
  anchorTabId?: string
  discardDirty?: boolean
}

export interface MarkTabSavedOptions {
  filePath?: string
  markdown?: string
}

export interface TabsClosedResult {
  status: 'closed'
  closed: true
  requiresConfirmation: false
  tabs: EditorTab[]
  dirtyTabs: EditorTab[]
  closedTabIds: string[]
  dirtyTabIds: string[]
  activeTabId?: string
}

export interface CloseTabsConfirmationResult {
  status: 'confirmation-required'
  closed: false
  requiresConfirmation: true
  tabs: EditorTab[]
  dirtyTabs: EditorTab[]
  closedTabIds: []
  dirtyTabIds: string[]
  activeTabId?: string
}

export interface CloseTabsNotFoundResult {
  status: 'not-found'
  closed: false
  requiresConfirmation: false
  tabs: []
  dirtyTabs: []
  closedTabIds: []
  dirtyTabIds: []
  activeTabId?: string
}

export type CloseTabsResult =
  | TabsClosedResult
  | CloseTabsConfirmationResult
  | CloseTabsNotFoundResult

export interface MarkTabSavedResult {
  saved: boolean
  duplicateTabId?: string
}

interface EditorTabsState {
  tabs: EditorTab[]
  activeTabId?: string
  savedMarkdownByTabId: Record<string, string>
}

interface EditorTabsActions {
  openTab: (input: OpenEditorTabInput) => OpenTabResult
  createUntitledTab: (options?: CreateUntitledTabOptions) => string
  activateTab: (tabId: string) => void
  updateTabMarkdown: (tabId: string, markdown: string) => void
  setTabEditorMode: (tabId: string, editorMode: EditorTab['editorMode']) => void
  setTabScrollPosition: (tabId: string, scrollPosition?: number) => void
  markTabSaved: (tabId: string, options?: MarkTabSavedOptions) => MarkTabSavedResult
  updateTabFilePath: (tabId: string, filePath?: string, title?: string) => boolean
  getCloseCandidates: (scope: CloseTabsScope, anchorTabId?: string) => EditorTab[]
  closeTabs: (scope: CloseTabsScope, options?: CloseTabsOptions) => CloseTabsResult
}

export type EditorTabsStore = EditorTabsState & EditorTabsActions

const initialEditorTabsState: EditorTabsState = {
  tabs: [],
  activeTabId: undefined,
  savedMarkdownByTabId: {},
}

let fallbackId = 0

function createTabId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  fallbackId += 1
  return `editor-tab-${Date.now()}-${fallbackId}`
}

/**
 * Creates a comparison key without importing Node's path module into the renderer.
 * Windows drive and UNC paths are case-insensitive; POSIX paths preserve case.
 */
export function normalizeEditorTabPath(filePath: string): string {
  const slashPath = filePath.replace(/\\/g, '/')
  const isUncPath = slashPath.startsWith('//')
  const isWindowsDrivePath = /^[a-zA-Z]:(?:\/|$)/.test(slashPath)
  const isAbsolutePosixPath = slashPath.startsWith('/') && !isUncPath

  let remainder = slashPath
  let prefix = ''
  if (isUncPath) {
    prefix = '//'
    remainder = slashPath.slice(2)
  } else if (isWindowsDrivePath) {
    prefix = slashPath.slice(0, 2)
    remainder = slashPath.slice(2).replace(/^\/+/, '')
  } else if (isAbsolutePosixPath) {
    prefix = '/'
    remainder = slashPath.slice(1)
  }

  const segments: string[] = []
  for (const segment of remainder.split(/\/+/)) {
    if (!segment || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') {
      segments.pop()
      continue
    }
    if (segment === '..' && (prefix === '/' || isUncPath || isWindowsDrivePath)) continue
    segments.push(segment)
  }

  let normalized: string
  if (prefix === '/') {
    normalized = `/${segments.join('/')}`
  } else if (prefix === '//') {
    normalized = `//${segments.join('/')}`
  } else if (isWindowsDrivePath) {
    normalized = `${prefix}/${segments.join('/')}`.replace(/\/$/, '')
  } else {
    normalized = segments.join('/')
  }

  return isUncPath || isWindowsDrivePath ? normalized.toLocaleLowerCase('en-US') : normalized
}

function findTabIdByPath(tabs: readonly EditorTab[], filePath: string): string | undefined {
  const pathKey = normalizeEditorTabPath(filePath)
  return tabs.find(
    (tab) => tab.filePath !== undefined && normalizeEditorTabPath(tab.filePath) === pathKey,
  )?.id
}

function getCandidateIds(
  tabs: readonly EditorTab[],
  activeTabId: string | undefined,
  scope: CloseTabsScope,
  anchorTabId?: string,
): string[] {
  const anchorId = anchorTabId ?? activeTabId
  if (!anchorId) return []

  const anchorIndex = tabs.findIndex((tab) => tab.id === anchorId)
  if (anchorIndex < 0) return []

  switch (scope) {
    case 'current':
      return [anchorId]
    case 'others':
      return tabs.filter((tab) => tab.id !== anchorId).map((tab) => tab.id)
    case 'right':
      return tabs.slice(anchorIndex + 1).map((tab) => tab.id)
  }
}

function nextActiveTabId(
  oldTabs: readonly EditorTab[],
  remainingTabs: readonly EditorTab[],
  oldActiveTabId: string | undefined,
  closedTabIds: ReadonlySet<string>,
  anchorTabId?: string,
): string | undefined {
  if (oldActiveTabId && !closedTabIds.has(oldActiveTabId)) return oldActiveTabId
  if (anchorTabId && !closedTabIds.has(anchorTabId)) return anchorTabId
  if (remainingTabs.length === 0) return undefined

  const firstClosedIndex = oldTabs.findIndex((tab) => closedTabIds.has(tab.id))
  return remainingTabs[Math.min(Math.max(firstClosedIndex, 0), remainingTabs.length - 1)]?.id
}

function createUntitledTitle(tabs: readonly EditorTab[]): string {
  const titles = new Set(tabs.map((tab) => tab.title))
  if (!titles.has('未命名')) return '未命名'

  let suffix = 2
  while (titles.has(`未命名 ${suffix}`)) suffix += 1
  return `未命名 ${suffix}`
}

export const useEditorTabsStore = create<EditorTabsStore>((set, get) => ({
  ...initialEditorTabsState,
  openTab: (input) => {
    const state = get()
    const duplicateTabId = input.filePath ? findTabIdByPath(state.tabs, input.filePath) : undefined
    if (duplicateTabId) {
      set({ activeTabId: duplicateTabId })
      return { tabId: duplicateTabId, opened: false }
    }

    const duplicateId = input.id ? state.tabs.find((tab) => tab.id === input.id)?.id : undefined
    if (duplicateId) {
      set({ activeTabId: duplicateId })
      return { tabId: duplicateId, opened: false }
    }

    const tab: EditorTab = {
      id: input.id ?? createTabId(),
      filePath: input.filePath,
      title: input.title,
      markdown: input.markdown,
      dirty: input.dirty ?? false,
      editorMode: input.editorMode ?? 'visual',
      scrollPosition: input.scrollPosition,
    }

    set((current) => ({
      tabs: [...current.tabs, tab],
      activeTabId: tab.id,
      savedMarkdownByTabId: {
        ...current.savedMarkdownByTabId,
        [tab.id]: tab.dirty ? '' : tab.markdown,
      },
    }))
    return { tabId: tab.id, opened: true }
  },
  createUntitledTab: (options = {}) => {
    const result = get().openTab({
      title: options.title ?? createUntitledTitle(get().tabs),
      markdown: options.markdown ?? '',
      editorMode: options.editorMode,
      scrollPosition: options.scrollPosition,
    })
    return result.tabId
  },
  activateTab: (tabId) => {
    if (get().tabs.some((tab) => tab.id === tabId)) set({ activeTabId: tabId })
  },
  updateTabMarkdown: (tabId, markdown) => {
    set((state) => {
      const savedMarkdown = state.savedMarkdownByTabId[tabId]
      let changed = false
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== tabId || tab.markdown === markdown) return tab
        changed = true
        return {
          ...tab,
          markdown,
          dirty: savedMarkdown === undefined ? true : markdown !== savedMarkdown,
        }
      })
      return changed ? { tabs } : state
    })
  },
  setTabEditorMode: (tabId, editorMode) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, editorMode } : tab)),
    }))
  },
  setTabScrollPosition: (tabId, scrollPosition) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, scrollPosition } : tab)),
    }))
  },
  markTabSaved: (tabId, options = {}) => {
    const state = get()
    const tab = state.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return { saved: false }

    const { filePath } = options
    const duplicateTabId = filePath ? findTabIdByPath(state.tabs, filePath) : undefined
    if (duplicateTabId && duplicateTabId !== tabId) {
      return { saved: false, duplicateTabId }
    }

    const savedSnapshot = options.markdown ?? tab.markdown
    set((current) => ({
      tabs: current.tabs.map((candidate) =>
        candidate.id === tabId
          ? {
              ...candidate,
              filePath: filePath ?? candidate.filePath,
              dirty: candidate.markdown !== savedSnapshot,
            }
          : candidate,
      ),
      savedMarkdownByTabId: {
        ...current.savedMarkdownByTabId,
        [tabId]: savedSnapshot,
      },
    }))
    return { saved: true }
  },
  updateTabFilePath: (tabId, filePath, title) => {
    const state = get()
    if (!state.tabs.some((tab) => tab.id === tabId)) return false

    const duplicateTabId = filePath ? findTabIdByPath(state.tabs, filePath) : undefined
    if (duplicateTabId && duplicateTabId !== tabId) return false

    set((current) => ({
      tabs: current.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              filePath,
              title: title ?? tab.title,
            }
          : tab,
      ),
    }))
    return true
  },
  getCloseCandidates: (scope, anchorTabId) => {
    const state = get()
    const candidateIds = new Set(getCandidateIds(state.tabs, state.activeTabId, scope, anchorTabId))
    return state.tabs.filter((tab) => candidateIds.has(tab.id))
  },
  closeTabs: (scope, options = {}) => {
    const state = get()
    const anchorTabId = options.anchorTabId ?? state.activeTabId
    if (!anchorTabId || !state.tabs.some((tab) => tab.id === anchorTabId)) {
      return {
        status: 'not-found',
        closed: false,
        requiresConfirmation: false,
        tabs: [],
        dirtyTabs: [],
        closedTabIds: [],
        dirtyTabIds: [],
        activeTabId: state.activeTabId,
      }
    }

    const candidates = state.getCloseCandidates(scope, options.anchorTabId)
    const dirtyTabs = candidates.filter((tab) => tab.dirty)
    const dirtyTabIds = dirtyTabs.map((tab) => tab.id)

    if (dirtyTabIds.length > 0 && !options.discardDirty) {
      return {
        status: 'confirmation-required',
        closed: false,
        requiresConfirmation: true,
        tabs: candidates,
        dirtyTabs,
        closedTabIds: [],
        dirtyTabIds,
        activeTabId: state.activeTabId,
      }
    }

    const closedTabIds = candidates.map((tab) => tab.id)
    if (closedTabIds.length === 0) {
      return {
        status: 'closed',
        closed: true,
        requiresConfirmation: false,
        tabs: [],
        dirtyTabs: [],
        closedTabIds,
        dirtyTabIds: [],
        activeTabId: state.activeTabId,
      }
    }

    const closedTabIdSet = new Set(closedTabIds)
    const remainingTabs = state.tabs.filter((tab) => !closedTabIdSet.has(tab.id))
    const activeTabId = nextActiveTabId(
      state.tabs,
      remainingTabs,
      state.activeTabId,
      closedTabIdSet,
      options.anchorTabId,
    )
    const savedMarkdownByTabId = { ...state.savedMarkdownByTabId }
    for (const tabId of closedTabIds) delete savedMarkdownByTabId[tabId]

    set({ tabs: remainingTabs, activeTabId, savedMarkdownByTabId })
    return {
      status: 'closed',
      closed: true,
      requiresConfirmation: false,
      tabs: candidates,
      dirtyTabs,
      closedTabIds,
      dirtyTabIds,
      activeTabId,
    }
  },
}))

export function resetEditorTabsStore(): void {
  fallbackId = 0
  useEditorTabsStore.setState({
    tabs: [],
    activeTabId: undefined,
    savedMarkdownByTabId: {},
  })
}
