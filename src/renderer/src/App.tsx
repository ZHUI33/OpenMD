import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import type {
  RendererCommand,
  WorkspaceEntry,
  WorkspaceFileChange,
  WorkspaceInfo,
  WorkspaceSearchMatch,
} from '../../shared/desktop-api.types'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import type { AppSettings, AppSettingsUpdate, BuiltInTheme } from '../../shared/settings'
import { FileConflictDialog } from './components/FileConflictDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { TitleBar } from './components/TitleBar'
import { WorkspaceSearch } from './components/WorkspaceSearch'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { OpenMdEditor } from './editor/OpenMdEditor'
import type { OpenMdEditorHandle, ResolvedTheme } from './editor/editor.types'
import { resolveExternalFileChange } from './external-file-state'
import { getRendererSettingsApi } from './settings/settings-api'
import { getApplicationThemeController } from './settings/theme-controller'
import { useAppStore } from './stores/app-store'
import { normalizeEditorTabPath, useEditorTabsStore } from './stores/editor-tabs-store'
import type { CloseTabsScope, EditorTab } from './stores/editor-tabs-store'

interface FileConflictState {
  tabId: string
  diskMarkdown?: string
  deleted: boolean
}

interface ToastState {
  id: number
  message: string
  kind: 'info' | 'error'
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath
}

function findTabByPath(tabs: readonly EditorTab[], filePath: string): EditorTab | undefined {
  const key = normalizeEditorTabPath(filePath)
  return tabs.find((tab) => tab.filePath && normalizeEditorTabPath(tab.filePath) === key)
}

function descendantSuffix(parentPath: string, candidatePath: string): string | undefined {
  const parent = parentPath.replace(/\\/g, '/').replace(/\/$/u, '')
  const candidate = candidatePath.replace(/\\/g, '/')
  const caseInsensitive = /^(?:[a-z]:|\/\/)/iu.test(parent)
  const comparableParent = caseInsensitive ? parent.toLocaleLowerCase('en-US') : parent
  const comparableCandidate = caseInsensitive ? candidate.toLocaleLowerCase('en-US') : candidate
  if (comparableCandidate === comparableParent) return ''
  if (!comparableCandidate.startsWith(`${comparableParent}/`)) return undefined
  return candidate.slice(parent.length)
}

function joinPortablePath(parentPath: string, slashSuffix: string): string {
  const separator = parentPath.includes('\\') ? '\\' : '/'
  return `${parentPath.replace(/[\\/]$/u, '')}${slashSuffix.replace(/\//g, separator)}`
}

function isBuiltInTheme(theme: AppSettings['theme']): theme is BuiltInTheme {
  return theme === 'light' || theme === 'dark' || theme === 'system'
}

function App(): JSX.Element {
  const tabs = useEditorTabsStore((state) => state.tabs)
  const activeTabId = useEditorTabsStore((state) => state.activeTabId)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)
  const sidebarVisible = useAppStore((state) => state.sidebarVisible)
  const setSidebarVisible = useAppStore((state) => state.setSidebarVisible)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const setSourceCursor = useAppStore((state) => state.setSourceCursor)
  const editorRef = useRef<OpenMdEditorHandle>(null)
  const activeTabIdRef = useRef(activeTabId)
  const displayGenerationRef = useRef(0)
  const workspaceNavigationRef = useRef(0)
  const savingTabIdsRef = useRef(new Set<string>())
  const autoSaveTimersRef = useRef(new Map<string, { timer: number; signature: string }>())
  const toastSequenceRef = useRef(0)
  const commandHandlerRef = useRef<(command: RendererCommand) => Promise<void>>(
    async () => undefined,
  )
  const relativePathByTabIdRef = useRef(new Map<string, string>())
  const settingsApi = useMemo(() => getRendererSettingsApi(), [])
  const themeController = useMemo(() => getApplicationThemeController(settingsApi), [settingsApi])
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsReady, setSettingsReady] = useState(false)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')
  const [workspace, setWorkspace] = useState<WorkspaceInfo>()
  const [searchVisible, setSearchVisible] = useState(false)
  const [conflicts, setConflicts] = useState<Record<string, FileConflictState>>({})
  const [deletedTabIds, setDeletedTabIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState>()

  activeTabIdRef.current = activeTabId

  const showToast = useCallback((message: string, kind: ToastState['kind'] = 'info'): void => {
    toastSequenceRef.current += 1
    setToast({ id: toastSequenceRef.current, message, kind })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const captureActiveEditor = useCallback((): void => {
    const tabId = activeTabIdRef.current
    const editor = editorRef.current
    if (!tabId || !editor) return
    const markdown = editor.getMarkdown()
    const store = useEditorTabsStore.getState()
    store.updateTabMarkdown(tabId, markdown)
    store.setTabEditorMode(tabId, editor.getMode())
    store.setTabScrollPosition(tabId, editor.getScrollPosition?.())
  }, [])

  const displayTab = useCallback(async (tabId: string, revealLine?: number): Promise<void> => {
    const generation = ++displayGenerationRef.current
    const store = useEditorTabsStore.getState()
    const tab = store.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return

    store.activateTab(tabId)
    activeTabIdRef.current = tabId
    const editor = editorRef.current
    if (!editor) return

    editor.setReadOnly(true)
    try {
      editor.setMarkdown(tab.markdown)
      await editor.setMode(tab.editorMode)
      await editor.whenIdle()
      if (generation !== displayGenerationRef.current) return
      editor.setScrollPosition?.(tab.scrollPosition ?? 0)
      if (revealLine !== undefined) editor.revealLine?.(revealLine)
      else editor.focus()
    } finally {
      editor.setReadOnly(false)
    }
  }, [])

  const switchToTab = useCallback(
    async (tabId: string): Promise<void> => {
      if (tabId === activeTabIdRef.current) {
        editorRef.current?.focus()
        return
      }
      captureActiveEditor()
      await displayTab(tabId)
    },
    [captureActiveEditor, displayTab],
  )

  const ensureOneTab = useCallback(async (): Promise<string> => {
    const store = useEditorTabsStore.getState()
    if (store.activeTabId) return store.activeTabId
    const tabId = store.createUntitledTab({
      title: '欢迎',
      markdown: '# 欢迎使用 OpenMD\n\n打开一个文件夹，或新建 Markdown 文档开始写作。',
      editorMode: settings.defaultEditorMode,
    })
    await displayTab(tabId)
    return tabId
  }, [displayTab, settings.defaultEditorMode])

  const createUntitledTab = useCallback(async (): Promise<void> => {
    captureActiveEditor()
    const tabId = useEditorTabsStore.getState().createUntitledTab({
      editorMode: settings.defaultEditorMode,
    })
    await displayTab(tabId)
  }, [captureActiveEditor, displayTab, settings.defaultEditorMode])

  const openDocumentResult = useCallback(
    async (result: { canceled: boolean; error?: boolean; filePath?: string; content?: string }) => {
      if (result.canceled || result.error || !result.filePath || result.content === undefined)
        return
      captureActiveEditor()
      const openResult = useEditorTabsStore.getState().openTab({
        filePath: result.filePath,
        title: fileNameFromPath(result.filePath),
        markdown: result.content,
        editorMode: settings.defaultEditorMode,
      })
      await displayTab(openResult.tabId)
    },
    [captureActiveEditor, displayTab, settings.defaultEditorMode],
  )

  const openDocument = useCallback(
    async (filePath?: string): Promise<void> => {
      try {
        const result = await window.openmd.documents.openDocument(filePath ? { filePath } : {})
        await openDocumentResult(result)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '打开文件失败。', 'error')
      }
    },
    [openDocumentResult, showToast],
  )

  const openWorkspaceFile = useCallback(
    async (relativePath: string, revealLine?: number): Promise<void> => {
      const navigationId = ++workspaceNavigationRef.current
      try {
        const file = await window.openmd.workspace.readFile({ relativePath })
        if (navigationId !== workspaceNavigationRef.current) return
        captureActiveEditor()
        const result = useEditorTabsStore.getState().openTab({
          filePath: file.filePath,
          title: fileNameFromPath(file.filePath),
          markdown: file.content,
          editorMode: settings.defaultEditorMode,
        })
        relativePathByTabIdRef.current.set(result.tabId, file.relativePath)
        await displayTab(result.tabId, revealLine)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '读取工作区文件失败。', 'error')
      }
    },
    [captureActiveEditor, displayTab, settings.defaultEditorMode, showToast],
  )

  const openWorkspace = useCallback(async (): Promise<void> => {
    try {
      const result = await window.openmd.workspace.open()
      if (result.canceled || !result.workspace) return
      workspaceNavigationRef.current += 1
      relativePathByTabIdRef.current.clear()
      setWorkspace(result.workspace)
      setSearchVisible(false)
      setSidebarVisible(true)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打开工作区失败。', 'error')
    }
  }, [setSidebarVisible, showToast])

  const handleWorkspaceEntryRenamed = useCallback(
    (previous: WorkspaceEntry, renamed: WorkspaceEntry): void => {
      const store = useEditorTabsStore.getState()
      for (const tab of store.tabs) {
        if (!tab.filePath) continue
        const suffix = descendantSuffix(previous.filePath, tab.filePath)
        if (suffix === undefined) continue
        const nextPath = joinPortablePath(renamed.filePath, suffix)
        store.updateTabFilePath(
          tab.id,
          nextPath,
          suffix ? tab.title : fileNameFromPath(renamed.filePath),
        )
        const previousRelativePath = relativePathByTabIdRef.current.get(tab.id)
        if (previousRelativePath !== undefined) {
          const relativeSuffix = descendantSuffix(previous.relativePath, previousRelativePath)
          if (relativeSuffix !== undefined) {
            relativePathByTabIdRef.current.set(
              tab.id,
              joinPortablePath(renamed.relativePath, relativeSuffix),
            )
          }
        }
      }
      showToast(`已重命名为 ${renamed.name}`)
    },
    [showToast],
  )

  const handleWorkspaceEntryDeleted = useCallback((entry: WorkspaceEntry): void => {
    const affected = useEditorTabsStore
      .getState()
      .tabs.filter(
        (tab) => tab.filePath && descendantSuffix(entry.filePath, tab.filePath) !== undefined,
      )
    if (affected.length === 0) return
    setDeletedTabIds((current) => {
      const next = new Set(current)
      for (const tab of affected) next.add(tab.id)
      return next
    })
    setConflicts((current) => {
      const next = { ...current }
      for (const tab of affected) next[tab.id] = { tabId: tab.id, deleted: true }
      return next
    })
  }, [])

  const handleSidebarError = useCallback(
    (message: string): void => showToast(message, 'error'),
    [showToast],
  )

  const handleOpenWorkspaceRequest = useCallback((): void => {
    void openWorkspace()
  }, [openWorkspace])

  const handleWorkspaceFileRequest = useCallback(
    (entry: WorkspaceEntry): void => {
      void openWorkspaceFile(entry.relativePath)
    },
    [openWorkspaceFile],
  )

  const handleSearchVisibleChange = useCallback(
    (visible: boolean): void => {
      if (!workspace && visible) showToast('请先打开一个工作区。')
      else setSearchVisible(visible)
    },
    [showToast, workspace],
  )

  const closeWorkspaceSearch = useCallback((): void => setSearchVisible(false), [])
  const openWorkspaceSearchResult = useCallback(
    (match: WorkspaceSearchMatch): void => {
      void openWorkspaceFile(match.relativePath, match.lineNumber)
    },
    [openWorkspaceFile],
  )

  const saveTab = useCallback(
    async (tabId: string, saveAs: boolean, silent = false): Promise<boolean> => {
      if (savingTabIdsRef.current.has(tabId)) return false
      if (tabId === activeTabIdRef.current) captureActiveEditor()
      const store = useEditorTabsStore.getState()
      const tab = store.tabs.find((candidate) => candidate.id === tabId)
      if (!tab) return false

      savingTabIdsRef.current.add(tabId)
      const submittedMarkdown = tab.markdown
      try {
        const result = await window.openmd.documents.saveDocument({
          filePath: tab.filePath,
          content: submittedMarkdown,
          saveAs,
          forbiddenFilePaths: store.tabs
            .filter((candidate) => candidate.id !== tab.id && candidate.filePath)
            .map((candidate) => candidate.filePath!),
        })
        if (result.canceled) return false
        if (result.error || !result.filePath) {
          if (!silent) showToast('保存文件失败。', 'error')
          return false
        }

        const saved = useEditorTabsStore.getState().markTabSaved(tabId, {
          filePath: result.filePath,
          markdown: submittedMarkdown,
        })
        if (!saved.saved) {
          showToast('该路径已经在另一个标签中打开，无法创建重复标签。', 'error')
          return false
        }
        useEditorTabsStore
          .getState()
          .updateTabFilePath(tabId, result.filePath, fileNameFromPath(result.filePath))
        if (
          tab.filePath &&
          normalizeEditorTabPath(tab.filePath) !== normalizeEditorTabPath(result.filePath)
        ) {
          await window.openmd.documents
            .releaseDocument({ filePath: tab.filePath })
            .catch(() => undefined)
          relativePathByTabIdRef.current.delete(tabId)
        }
        setDeletedTabIds((current) => {
          const next = new Set(current)
          next.delete(tabId)
          return next
        })
        setConflicts((current) => {
          const next = { ...current }
          delete next[tabId]
          return next
        })
        if (!silent) showToast(`已保存 ${fileNameFromPath(result.filePath)}`)
        return true
      } catch (error) {
        if (!silent) {
          showToast(error instanceof Error ? error.message : '保存文件失败。', 'error')
        }
        return false
      } finally {
        savingTabIdsRef.current.delete(tabId)
      }
    },
    [captureActiveEditor, showToast],
  )

  const confirmTabs = useCallback(
    async (candidates: readonly EditorTab[]): Promise<boolean> => {
      captureActiveEditor()
      for (const candidate of candidates) {
        const current = useEditorTabsStore.getState().tabs.find((tab) => tab.id === candidate.id)
        if (
          !current ||
          (!current.dirty && !deletedTabIds.has(current.id) && !conflicts[current.id])
        ) {
          continue
        }
        const forbiddenFilePaths = useEditorTabsStore
          .getState()
          .tabs.filter((tab) => tab.id !== current.id && tab.filePath)
          .map((tab) => tab.filePath!)
        const confirmation = await window.openmd.documents.confirmClose({
          filePath: deletedTabIds.has(current.id) ? undefined : current.filePath,
          content: current.markdown,
          forbiddenFilePaths,
        })
        if (confirmation.action === 'cancel') return false
        if (confirmation.action === 'save' && confirmation.filePath) {
          const saved = useEditorTabsStore.getState().markTabSaved(current.id, {
            filePath: confirmation.filePath,
            markdown: current.markdown,
          })
          if (!saved.saved) return false
          useEditorTabsStore
            .getState()
            .updateTabFilePath(
              current.id,
              confirmation.filePath,
              fileNameFromPath(confirmation.filePath),
            )
          if (
            current.filePath &&
            normalizeEditorTabPath(current.filePath) !==
              normalizeEditorTabPath(confirmation.filePath)
          ) {
            await window.openmd.documents
              .releaseDocument({ filePath: current.filePath })
              .catch(() => undefined)
            relativePathByTabIdRef.current.delete(current.id)
          }
          setDeletedTabIds((deleted) => {
            const next = new Set(deleted)
            next.delete(current.id)
            return next
          })
          setConflicts((existing) => {
            const next = { ...existing }
            delete next[current.id]
            return next
          })
        }
      }
      return true
    },
    [captureActiveEditor, conflicts, deletedTabIds],
  )

  const closeTabs = useCallback(
    async (scope: CloseTabsScope, anchorTabId?: string): Promise<void> => {
      captureActiveEditor()
      const store = useEditorTabsStore.getState()
      const previousActiveTabId = store.activeTabId
      const candidates = store.getCloseCandidates(scope, anchorTabId)
      if (!(await confirmTabs(candidates))) return
      const result = useEditorTabsStore.getState().closeTabs(scope, {
        anchorTabId,
        discardDirty: true,
      })
      if (result.status !== 'closed') return

      await Promise.all(
        result.tabs.flatMap((tab) =>
          tab.filePath ? [window.openmd.documents.releaseDocument({ filePath: tab.filePath })] : [],
        ),
      ).catch(() => undefined)

      for (const tabId of result.closedTabIds) relativePathByTabIdRef.current.delete(tabId)
      setDeletedTabIds((current) => {
        const next = new Set(current)
        for (const tabId of result.closedTabIds) next.delete(tabId)
        return next
      })
      setConflicts((current) => {
        const next = { ...current }
        for (const tabId of result.closedTabIds) delete next[tabId]
        return next
      })
      const nextTabId = useEditorTabsStore.getState().activeTabId
      if (!nextTabId) {
        await ensureOneTab()
      } else if (nextTabId !== previousActiveTabId) {
        await displayTab(nextTabId)
      }
    },
    [captureActiveEditor, confirmTabs, displayTab, ensureOneTab],
  )

  const reloadActiveFromDisk = useCallback(async (): Promise<void> => {
    captureActiveEditor()
    const tabBeforeConfirmation = useEditorTabsStore
      .getState()
      .tabs.find((candidate) => candidate.id === activeTabIdRef.current)
    if (!tabBeforeConfirmation?.filePath) return
    if (!(await confirmTabs([tabBeforeConfirmation]))) return
    const tab = useEditorTabsStore
      .getState()
      .tabs.find((candidate) => candidate.id === tabBeforeConfirmation.id)
    if (!tab?.filePath) return

    const relativePath = relativePathByTabIdRef.current.get(tab.id)
    try {
      const result = relativePath
        ? await window.openmd.workspace.readFile({ relativePath })
        : await window.openmd.documents.openDocument({ filePath: tab.filePath })
      if ('canceled' in result && (result.canceled || result.error)) return
      if (result.content === undefined) return
      useEditorTabsStore.getState().updateTabMarkdown(tab.id, result.content)
      useEditorTabsStore.getState().markTabSaved(tab.id, { markdown: result.content })
      await displayTab(tab.id)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重新加载文件失败。', 'error')
    }
  }, [captureActiveEditor, confirmTabs, displayTab, showToast])

  const applyRuntimeSettings = useCallback(
    async (nextSettings: AppSettings): Promise<void> => {
      const previous = settings
      await themeController.apply(nextSettings)
      setSettings(nextSettings)
      setResolvedTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
      if (isBuiltInTheme(nextSettings.theme)) {
        useAppStore.getState().setTheme(nextSettings.theme)
      }

      if (previous.sourceLineNumbers !== nextSettings.sourceLineNumbers) {
        editorRef.current?.toggleSourceLineNumbers()
      }
      if (previous.sourceLineWrapping !== nextSettings.sourceLineWrapping) {
        editorRef.current?.toggleSourceLineWrapping()
      }
      useAppStore.getState().setSourceLineNumbers(nextSettings.sourceLineNumbers)
      useAppStore.getState().setSourceLineWrapping(nextSettings.sourceLineWrapping)
    },
    [settings, themeController],
  )

  const updateSetting = useCallback(
    (update: AppSettingsUpdate): void => {
      void settingsApi
        .update(update)
        .then((saved) => applyRuntimeSettings(saved))
        .catch(() => showToast('保存设置失败。', 'error'))
    },
    [applyRuntimeSettings, settingsApi, showToast],
  )

  useEffect(() => {
    let active = true
    void settingsApi
      .get()
      .then(async (loadedSettings) => {
        if (!active) return
        await applyRuntimeSettings(loadedSettings)
        if (active) setSettingsReady(true)
      })
      .catch(async () => {
        if (active) {
          try {
            const recoveredSettings = await settingsApi.update({ theme: 'system' })
            if (active) await applyRuntimeSettings(recoveredSettings)
          } catch {
            // Defaults remain active when the settings file itself is unavailable.
          }
          setSettingsReady(true)
          showToast('无法读取设置，已使用默认值。', 'error')
        }
      })
    return () => {
      active = false
    }
    // Loading is intentionally one-shot; subsequent updates flow through the dialog/API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!settingsReady) return
    void ensureOneTab()
  }, [ensureOneTab, settingsReady])

  useEffect(() => {
    void window.openmd.workspace
      .getCurrent()
      .then((currentWorkspace) => {
        if (currentWorkspace) {
          setWorkspace(currentWorkspace)
          setSidebarVisible(true)
        }
      })
      .catch(() => undefined)
  }, [setSidebarVisible])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateResolvedTheme = (): void => {
      if (settings.theme === 'system') {
        setResolvedTheme(media.matches ? 'dark' : 'light')
      }
    }
    media.addEventListener('change', updateResolvedTheme)
    return () => media.removeEventListener('change', updateResolvedTheme)
  }, [settings.theme])

  useEffect(() => {
    document.title = activeTab
      ? `${activeTab.title}${activeTab.dirty ? ' *' : ''} — OpenMD`
      : 'OpenMD'
  }, [activeTab])

  useEffect(() => {
    const removeListener = window.openmd.documents.onCommand((command) => {
      void commandHandlerRef.current(command)
    })
    void window.openmd.documents.ready().catch((error: unknown) => {
      console.error('Failed to register the document command listener:', error)
    })
    return removeListener
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLocaleLowerCase('en-US') === 'o') {
        event.preventDefault()
        void openWorkspace()
      } else if (event.key.toLocaleLowerCase('en-US') === 'f') {
        event.preventDefault()
        if (workspace) setSearchVisible(true)
        else showToast('请先打开一个工作区。')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openWorkspace, showToast, workspace])

  useEffect(() => {
    return window.openmd.workspace.onFileChange((change: WorkspaceFileChange) => {
      void (async () => {
        const store = useEditorTabsStore.getState()
        const tab = findTabByPath(store.tabs, change.filePath)
        if (!tab) return
        const resolution = resolveExternalFileChange(change, tab.dirty)
        if (resolution.action === 'show-deleted') {
          setDeletedTabIds((current) => new Set(current).add(tab.id))
          setConflicts((current) => ({
            ...current,
            [tab.id]: { tabId: tab.id, deleted: true },
          }))
          return
        }
        setDeletedTabIds((current) => {
          const next = new Set(current)
          next.delete(tab.id)
          return next
        })

        let diskMarkdown = change.content
        if (diskMarkdown === undefined) {
          try {
            diskMarkdown = (
              await window.openmd.workspace.readFile({ relativePath: change.relativePath })
            ).content
          } catch {
            return
          }
        }
        if (resolution.action === 'show-conflict') {
          setConflicts((current) => ({
            ...current,
            [tab.id]: { tabId: tab.id, diskMarkdown, deleted: false },
          }))
          return
        }

        store.updateTabMarkdown(tab.id, diskMarkdown)
        store.markTabSaved(tab.id, { markdown: diskMarkdown })
        setConflicts((current) => {
          const next = { ...current }
          delete next[tab.id]
          return next
        })
        if (tab.id === activeTabIdRef.current) {
          editorRef.current?.setMarkdown(diskMarkdown)
        }
        showToast(`${tab.title} 已从磁盘重新加载。`)
      })()
    })
  }, [showToast])

  useEffect(() => {
    const timers = autoSaveTimersRef.current
    const eligibleTabs = new Map(
      tabs
        .filter(
          (tab) =>
            settings.autoSave &&
            tab.dirty &&
            Boolean(tab.filePath) &&
            !deletedTabIds.has(tab.id) &&
            !conflicts[tab.id],
        )
        .map((tab) => [tab.id, tab]),
    )

    for (const [tabId, pending] of timers) {
      const tab = eligibleTabs.get(tabId)
      const signature = tab
        ? `${tab.filePath ?? ''}\u0000${tab.markdown}\u0000${settings.autoSaveDelayMs}`
        : undefined
      if (signature !== pending.signature) {
        window.clearTimeout(pending.timer)
        timers.delete(tabId)
      }
    }

    for (const tab of eligibleTabs.values()) {
      if (timers.has(tab.id)) continue
      const signature = `${tab.filePath ?? ''}\u0000${tab.markdown}\u0000${settings.autoSaveDelayMs}`
      const timer = window.setTimeout(() => {
        const pending = timers.get(tab.id)
        if (pending?.signature === signature) timers.delete(tab.id)
        void saveTab(tab.id, false, true)
      }, settings.autoSaveDelayMs)
      timers.set(tab.id, { timer, signature })
    }
  }, [conflicts, deletedTabIds, saveTab, settings.autoSave, settings.autoSaveDelayMs, tabs])

  useEffect(() => {
    const timers = autoSaveTimersRef.current
    return () => {
      for (const pending of timers.values()) window.clearTimeout(pending.timer)
      timers.clear()
    }
  }, [])

  commandHandlerRef.current = async (command): Promise<void> => {
    switch (command.type) {
      case 'new':
        await createUntitledTab()
        break
      case 'open':
        await openDocument()
        break
      case 'open-recent':
        await openDocument(command.filePath)
        break
      case 'save':
        if (activeTabIdRef.current) await saveTab(activeTabIdRef.current, false)
        break
      case 'save-as':
        if (activeTabIdRef.current) await saveTab(activeTabIdRef.current, true)
        break
      case 'reload':
        await reloadActiveFromDisk()
        break
      case 'close': {
        const proceed = await confirmTabs(useEditorTabsStore.getState().tabs)
        await window.openmd.documents.resolveClose({
          intent: command.intent,
          requestId: command.requestId,
          proceed,
        })
        break
      }
      case 'toggle-editor-mode':
        await editorRef.current?.toggleMode()
        break
      case 'toggle-source-line-numbers':
        updateSetting({ sourceLineNumbers: !settings.sourceLineNumbers })
        break
      case 'toggle-source-line-wrapping':
        updateSetting({ sourceLineWrapping: !settings.sourceLineWrapping })
        break
      case 'open-workspace':
        await openWorkspace()
        break
      case 'search-workspace':
        if (workspace) setSearchVisible(true)
        else showToast('请先打开一个工作区。')
        break
    }
  }

  const conflict = (activeTabId ? conflicts[activeTabId] : undefined) ?? Object.values(conflicts)[0]
  const conflictTab = conflict
    ? useEditorTabsStore.getState().tabs.find((tab) => tab.id === conflict.tabId)
    : undefined

  return (
    <div className="app-shell">
      <TitleBar
        insertImageDisabled={!activeTab || activeTab.editorMode === 'source'}
        onToggleSidebar={toggleSidebar}
        onOpenWorkspace={handleOpenWorkspaceRequest}
        onOpenSearch={() => {
          if (workspace) setSearchVisible(true)
          else showToast('请先打开一个工作区。')
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onInsertImage={() => void editorRef.current?.insertImageFromPicker()}
      />
      <main
        className="workspace-layout"
        data-sidebar-visible={sidebarVisible}
        aria-label="编辑工作区"
      >
        <div className="workspace-sidebar-slot" hidden={!sidebarVisible}>
          <WorkspaceSidebar
            api={window.openmd.workspace}
            workspace={workspace}
            selectedFilePath={activeTab?.filePath}
            includeTextFiles={settings.showTextFiles}
            searchVisible={searchVisible}
            onOpenWorkspace={handleOpenWorkspaceRequest}
            onOpenFile={handleWorkspaceFileRequest}
            onEntryRenamed={handleWorkspaceEntryRenamed}
            onEntryDeleted={handleWorkspaceEntryDeleted}
            onSearchVisibleChange={handleSearchVisibleChange}
            onError={handleSidebarError}
          />
        </div>
        <section className="editor-pane" aria-label="文档标签与编辑器">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onActivate={(tabId) => void switchToTab(tabId)}
            onClose={(tabId) => void closeTabs('current', tabId)}
            onCloseOthers={(tabId) => void closeTabs('others', tabId)}
            onCloseRight={(tabId) => void closeTabs('right', tabId)}
          />
          <div className="editor-stage">
            {workspace && searchVisible ? (
              <WorkspaceSearch
                key={workspace.rootPath}
                api={window.openmd.workspace}
                includeTextFiles={settings.showTextFiles}
                onClose={closeWorkspaceSearch}
                onOpenResult={openWorkspaceSearchResult}
              />
            ) : null}
            {activeTab && deletedTabIds.has(activeTab.id) ? (
              <div className="deleted-file-banner" role="status">
                <span>此文件已从磁盘删除，标签中的内容仍被保留。</span>
                <button type="button" onClick={() => void saveTab(activeTab.id, true)}>
                  另存为
                </button>
              </div>
            ) : null}
            <OpenMdEditor
              ref={editorRef}
              initialMarkdown={activeTab?.markdown ?? ''}
              initialMode={activeTab?.editorMode ?? settings.defaultEditorMode}
              initialSourceLineNumbers={settings.sourceLineNumbers}
              initialSourceLineWrapping={settings.sourceLineWrapping}
              resolvedTheme={resolvedTheme}
              documentPath={activeTab?.filePath}
              imagesApi={window.openmd.images}
              onEnsureDocumentSaved={async () => {
                const tabId = activeTabIdRef.current
                if (!tabId) return undefined
                const saved = await saveTab(tabId, false)
                if (!saved) return undefined
                return useEditorTabsStore.getState().tabs.find((tab) => tab.id === tabId)?.filePath
              }}
              onChange={(markdown) => {
                const tabId = activeTabIdRef.current
                if (tabId) useEditorTabsStore.getState().updateTabMarkdown(tabId, markdown)
              }}
              onModeChange={(editorMode) => {
                const tabId = activeTabIdRef.current
                if (tabId) useEditorTabsStore.getState().setTabEditorMode(tabId, editorMode)
              }}
              onSourceCursorChange={setSourceCursor}
              onSourceLineNumbersChange={(sourceLineNumbers) => {
                useAppStore.getState().setSourceLineNumbers(sourceLineNumbers)
              }}
              onSourceLineWrappingChange={(sourceLineWrapping) => {
                useAppStore.getState().setSourceLineWrapping(sourceLineWrapping)
              }}
            />
          </div>
        </section>
      </main>
      <StatusBar />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settingsApi={settingsApi}
        themeController={null}
        onApplied={applyRuntimeSettings}
      />

      {conflict && conflictTab ? (
        <FileConflictDialog
          fileName={conflictTab.title}
          currentMarkdown={conflictTab.markdown}
          diskMarkdown={conflict.diskMarkdown}
          deleted={conflict.deleted}
          onResolve={(action) => {
            if (action === 'reload' && conflict.diskMarkdown !== undefined) {
              useEditorTabsStore.getState().updateTabMarkdown(conflict.tabId, conflict.diskMarkdown)
              useEditorTabsStore
                .getState()
                .markTabSaved(conflict.tabId, { markdown: conflict.diskMarkdown })
              if (conflict.tabId === activeTabIdRef.current) {
                editorRef.current?.setMarkdown(conflict.diskMarkdown)
              }
            }
            setConflicts((current) => {
              const next = { ...current }
              delete next[conflict.tabId]
              return next
            })
          }}
        />
      ) : null}

      {toast ? (
        <div className="app-toast" data-kind={toast.kind} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}

export default App
