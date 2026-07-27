import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent } from 'react'

import type { WorkspaceApi, WorkspaceEntry, WorkspaceInfo } from '../../../shared/desktop-api.types'
import { Icon } from './Icon'
import { WorkspaceDeleteConfirmation, WorkspaceEntryNameDialog } from './WorkspaceEntryDialogs'
import { friendlyWorkspaceError } from './workspace-entry-utils'
import type { EntryDialogMode } from './workspace-entry-utils'

export interface WorkspaceSidebarProps {
  api: WorkspaceApi
  workspace?: WorkspaceInfo
  selectedFilePath?: string
  includeTextFiles: boolean
  onOpenWorkspace: () => void
  onOpenFile: (entry: WorkspaceEntry) => void
  onEntryRenamed?: (previous: WorkspaceEntry, renamed: WorkspaceEntry) => void
  onEntryDeleted?: (entry: WorkspaceEntry) => void
  onError: (message: string) => void
}

const ROOT_KEY = ''
const TREE_PAGE_SIZE = 400

function parentPath(relativePath: string): string {
  const separatorIndex = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  return separatorIndex < 0 ? '' : relativePath.slice(0, separatorIndex)
}

function sortEntries(entries: readonly WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') return -1
    if (left.kind !== 'directory' && right.kind === 'directory') return 1
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

interface TreeBranchProps {
  parent: string
  depth: number
  childrenByPath: Readonly<Record<string, readonly WorkspaceEntry[]>>
  expanded: ReadonlySet<string>
  loading: ReadonlySet<string>
  selectedPath?: string
  visibleCounts: Readonly<Record<string, number>>
  onSelect: (entry: WorkspaceEntry) => void
  onToggle: (entry: WorkspaceEntry) => void
  onContextMenu: (event: ReactMouseEvent, entry: WorkspaceEntry) => void
  onShowMore: (parent: string) => void
}

function TreeBranch({
  parent,
  depth,
  childrenByPath,
  expanded,
  loading,
  selectedPath,
  visibleCounts,
  onSelect,
  onToggle,
  onContextMenu,
  onShowMore,
}: TreeBranchProps): JSX.Element {
  const entries = childrenByPath[parent] ?? []
  const visibleEntries = entries.slice(0, visibleCounts[parent] ?? TREE_PAGE_SIZE)
  return (
    <ul className="file-tree-branch" role={depth === 0 ? 'tree' : 'group'}>
      {visibleEntries.map((entry) => {
        const isDirectory = entry.kind === 'directory'
        const isExpanded = isDirectory && expanded.has(entry.relativePath)
        return (
          <li
            key={entry.relativePath}
            role="treeitem"
            aria-expanded={isDirectory ? isExpanded : undefined}
          >
            <button
              className="file-tree-row"
              type="button"
              data-selected={entry.filePath === selectedPath || entry.relativePath === selectedPath}
              style={{ paddingInlineStart: `${8 + depth * 14}px` }}
              title={entry.relativePath}
              onClick={() => {
                onSelect(entry)
                if (isDirectory) onToggle(entry)
              }}
              onContextMenu={(event) => onContextMenu(event, entry)}
            >
              <span className="tree-chevron" aria-hidden="true">
                {isDirectory && !loading.has(entry.relativePath) ? (
                  <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={13} />
                ) : null}
              </span>
              <span className="tree-entry-icon" aria-hidden="true">
                <Icon
                  name={isDirectory ? (isExpanded ? 'folder-open' : 'folder') : 'document'}
                  size={15}
                />
              </span>
              <span className="tree-entry-name">{entry.name}</span>
              {loading.has(entry.relativePath) ? (
                <span className="tree-loading" aria-label="正在读取" />
              ) : null}
            </button>
            {isExpanded ? (
              <TreeBranch
                parent={entry.relativePath}
                depth={depth + 1}
                childrenByPath={childrenByPath}
                expanded={expanded}
                loading={loading}
                selectedPath={selectedPath}
                visibleCounts={visibleCounts}
                onSelect={onSelect}
                onToggle={onToggle}
                onContextMenu={onContextMenu}
                onShowMore={onShowMore}
              />
            ) : null}
          </li>
        )
      })}
      {visibleEntries.length < entries.length ? (
        <li role="none">
          <button
            className="file-tree-more"
            type="button"
            style={{ paddingInlineStart: `${28 + depth * 14}px` }}
            onClick={() => onShowMore(parent)}
          >
            显示更多（剩余 {entries.length - visibleEntries.length} 项）
          </button>
        </li>
      ) : null}
    </ul>
  )
}

interface EntryDialogState {
  mode: EntryDialogMode
  entry?: WorkspaceEntry
}

interface ContextMenuState {
  entry: WorkspaceEntry
  x: number
  y: number
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  api,
  workspace,
  selectedFilePath,
  includeTextFiles,
  onOpenWorkspace,
  onOpenFile,
  onEntryRenamed,
  onEntryDeleted,
  onError,
}: WorkspaceSidebarProps): JSX.Element {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [selectedEntry, setSelectedEntry] = useState<WorkspaceEntry | undefined>()
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
  const [entryDialog, setEntryDialog] = useState<EntryDialogState>()
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceEntry>()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const [contextMenu, setContextMenu] = useState<ContextMenuState>()
  const workspaceRootRef = useRef(workspace?.rootPath)
  const directoryRequestIdsRef = useRef(new Map<string, number>())
  const treeGenerationRef = useRef(0)
  workspaceRootRef.current = workspace?.rootPath

  const loadDirectory = useCallback(
    async (relativePath: string): Promise<void> => {
      const workspaceRoot = workspace?.rootPath
      const treeGeneration = treeGenerationRef.current
      const requestId = (directoryRequestIdsRef.current.get(relativePath) ?? 0) + 1
      directoryRequestIdsRef.current.set(relativePath, requestId)
      setLoading((current) => new Set(current).add(relativePath))
      try {
        const entries = await api.listDirectory({
          relativePath: relativePath || undefined,
          includeTextFiles,
        })
        if (
          workspaceRootRef.current === workspaceRoot &&
          treeGenerationRef.current === treeGeneration &&
          directoryRequestIdsRef.current.get(relativePath) === requestId
        ) {
          setChildrenByPath((current) => ({ ...current, [relativePath]: sortEntries(entries) }))
        }
      } catch (error) {
        onError(friendlyWorkspaceError(error, '无法读取工作区目录。'))
      } finally {
        setLoading((current) => {
          if (
            treeGenerationRef.current !== treeGeneration ||
            directoryRequestIdsRef.current.get(relativePath) !== requestId
          ) {
            return current
          }
          const next = new Set(current)
          next.delete(relativePath)
          return next
        })
      }
    },
    [api, includeTextFiles, onError, workspace?.rootPath],
  )

  useEffect(() => {
    setChildrenByPath({})
    setExpanded(new Set())
    setSelectedEntry(undefined)
    setVisibleCounts({})
    setContextMenu(undefined)
    treeGenerationRef.current += 1
    directoryRequestIdsRef.current.clear()
    if (workspace) void loadDirectory(ROOT_KEY)
  }, [loadDirectory, workspace])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(undefined)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  const toggleDirectory = useCallback(
    (entry: WorkspaceEntry): void => {
      if (entry.kind !== 'directory') return
      const willExpand = !expanded.has(entry.relativePath)
      setExpanded((current) => {
        const next = new Set(current)
        if (willExpand) next.add(entry.relativePath)
        else next.delete(entry.relativePath)
        return next
      })
      if (willExpand && !childrenByPath[entry.relativePath]) void loadDirectory(entry.relativePath)
    },
    [childrenByPath, expanded, loadDirectory],
  )

  const operationParent = useMemo(() => {
    if (!selectedEntry) return ROOT_KEY
    return selectedEntry.kind === 'directory'
      ? selectedEntry.relativePath
      : parentPath(selectedEntry.relativePath)
  }, [selectedEntry])

  const refresh = async (): Promise<void> => {
    await Promise.all([ROOT_KEY, ...expanded].map((relativePath) => loadDirectory(relativePath)))
  }

  const submitEntryDialog = async (
    mode: EntryDialogMode,
    name: string,
    entry?: WorkspaceEntry,
  ): Promise<string | undefined> => {
    try {
      if (mode === 'create-file') {
        const created = await api.createMarkdownFile({
          parentRelativePath: operationParent || undefined,
          name,
        })
        setExpanded((current) => new Set(current).add(operationParent))
        await loadDirectory(operationParent)
        setSelectedEntry(created)
        setEntryDialog(undefined)
        onOpenFile(created)
      } else if (mode === 'create-directory') {
        await api.createDirectory({
          parentRelativePath: operationParent || undefined,
          name,
        })
        setExpanded((current) => new Set(current).add(operationParent))
        await loadDirectory(operationParent)
        setEntryDialog(undefined)
      } else if (entry) {
        if (name === entry.name) {
          setEntryDialog(undefined)
          return undefined
        }
        const renamed = await api.renameEntry({ relativePath: entry.relativePath, newName: name })
        onEntryRenamed?.(entry, renamed)
        setSelectedEntry(renamed)
        await loadDirectory(parentPath(entry.relativePath))
        setEntryDialog(undefined)
      }
      return undefined
    } catch (error) {
      return friendlyWorkspaceError(
        error,
        mode === 'create-file'
          ? '新建 Markdown 文件失败。'
          : mode === 'create-directory'
            ? '新建文件夹失败。'
            : '重命名失败。',
      )
    }
  }

  const requestDelete = (entry: WorkspaceEntry): void => {
    setContextMenu(undefined)
    setDeleteError(undefined)
    setDeleteTarget(entry)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(undefined)
    try {
      const result = await api.deleteEntry({ relativePath: deleteTarget.relativePath })
      if (!result.deleted) {
        setDeleteError('系统没有移动此项目，原项目仍保留。')
        return
      }
      onEntryDeleted?.(deleteTarget)
      setSelectedEntry(undefined)
      await loadDirectory(parentPath(deleteTarget.relativePath))
      setDeleteTarget(undefined)
    } catch (error) {
      setDeleteError(friendlyWorkspaceError(error, '无法移入系统回收站，原项目没有被删除。'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const openEntry = (entry: WorkspaceEntry): void => {
    setSelectedEntry(entry)
    if (entry.kind === 'directory') toggleDirectory(entry)
    else onOpenFile(entry)
  }

  const revealEntry = async (entry: WorkspaceEntry): Promise<void> => {
    try {
      await api.revealEntry({ relativePath: entry.relativePath })
    } catch (error) {
      onError(friendlyWorkspaceError(error, '无法在系统文件管理器中显示。'))
    }
  }

  const copyRelativePath = async (entry: WorkspaceEntry): Promise<void> => {
    try {
      await api.copyRelativePath({ relativePath: entry.relativePath })
    } catch (error) {
      onError(friendlyWorkspaceError(error, '复制相对路径失败。'))
    }
  }

  return (
    <section className="workspace-sidebar" aria-label="工作区文件">
      <header className="workspace-sidebar-header">
        <div>
          <span className="sidebar-kicker">工作区</span>
          <strong title={workspace?.rootPath}>{workspace?.name ?? '尚未打开文件夹'}</strong>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="打开文件夹 (Ctrl/Cmd+Shift+O)"
          title="打开文件夹 (Ctrl/Cmd+Shift+O)"
          onClick={onOpenWorkspace}
        >
          <Icon name="folder-open" />
        </button>
      </header>

      {workspace ? (
        <>
          <div className="workspace-toolbar" aria-label="文件操作">
            <button
              type="button"
              aria-label="新建 Markdown 文件"
              title="新建 Markdown 文件"
              onClick={() => setEntryDialog({ mode: 'create-file' })}
            >
              <Icon name="file-plus" />
            </button>
            <button
              type="button"
              aria-label="新建文件夹"
              title="新建文件夹"
              onClick={() => setEntryDialog({ mode: 'create-directory' })}
            >
              <Icon name="folder-plus" />
            </button>
            <button
              type="button"
              aria-label="重命名"
              title="重命名"
              disabled={!selectedEntry}
              onClick={() =>
                selectedEntry && setEntryDialog({ mode: 'rename', entry: selectedEntry })
              }
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              aria-label="移到系统回收站"
              title="移到系统回收站"
              disabled={!selectedEntry}
              onClick={() => selectedEntry && requestDelete(selectedEntry)}
            >
              <Icon name="trash" />
            </button>
            <span className="workspace-toolbar-spacer" />
            <button
              type="button"
              aria-label="刷新文件树"
              title="刷新文件树"
              onClick={() => void refresh()}
            >
              <Icon name="refresh" />
            </button>
          </div>
          <nav className="file-tree" aria-label="文件树">
            {loading.has(ROOT_KEY) && !childrenByPath[ROOT_KEY] ? (
              <p className="sidebar-empty">正在读取…</p>
            ) : (childrenByPath[ROOT_KEY]?.length ?? 0) === 0 ? (
              <p className="sidebar-empty">没有可显示的文件</p>
            ) : (
              <TreeBranch
                parent={ROOT_KEY}
                depth={0}
                childrenByPath={childrenByPath}
                expanded={expanded}
                loading={loading}
                selectedPath={selectedEntry?.relativePath ?? selectedFilePath}
                visibleCounts={visibleCounts}
                onSelect={(entry) => {
                  setSelectedEntry(entry)
                  if (entry.kind !== 'directory') onOpenFile(entry)
                }}
                onToggle={toggleDirectory}
                onContextMenu={(event, entry) => {
                  event.preventDefault()
                  setSelectedEntry(entry)
                  setContextMenu({ entry, x: event.clientX, y: event.clientY })
                }}
                onShowMore={(parent) =>
                  setVisibleCounts((current) => ({
                    ...current,
                    [parent]: (current[parent] ?? TREE_PAGE_SIZE) + TREE_PAGE_SIZE,
                  }))
                }
              />
            )}
          </nav>
        </>
      ) : (
        <div className="workspace-onboarding">
          <Icon name="folder-open" size={34} />
          <p>打开一个本地文件夹，浏览 Markdown 文档并进行全文搜索。</p>
          <button className="primary-button" type="button" onClick={onOpenWorkspace}>
            打开文件夹
          </button>
        </div>
      )}

      {contextMenu ? (
        <div
          className="desktop-menu workspace-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => openEntry(contextMenu.entry)}>
            <Icon name={contextMenu.entry.kind === 'directory' ? 'folder-open' : 'document'} />
            <span>打开</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(undefined)
              setEntryDialog({ mode: 'rename', entry: contextMenu.entry })
            }}
          >
            <Icon name="edit" />
            <span>重命名</span>
          </button>
          <button type="button" role="menuitem" onClick={() => requestDelete(contextMenu.entry)}>
            <Icon name="trash" />
            <span>移到系统回收站</span>
          </button>
          <div className="desktop-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(undefined)
              void revealEntry(contextMenu.entry)
            }}
          >
            <Icon name="external" />
            <span>在系统文件管理器中显示</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(undefined)
              void copyRelativePath(contextMenu.entry)
            }}
          >
            <Icon name="copy" />
            <span>复制相对路径</span>
          </button>
        </div>
      ) : null}

      {entryDialog ? (
        <WorkspaceEntryNameDialog
          mode={entryDialog.mode}
          entry={entryDialog.entry}
          initialValue={
            entryDialog.mode === 'rename'
              ? entryDialog.entry?.name
              : entryDialog.mode === 'create-file'
                ? '未命名.md'
                : '新建文件夹'
          }
          onCancel={() => setEntryDialog(undefined)}
          onConfirm={(name) => submitEntryDialog(entryDialog.mode, name, entryDialog.entry)}
        />
      ) : null}

      {deleteTarget ? (
        <WorkspaceDeleteConfirmation
          entry={deleteTarget}
          busy={deleteBusy}
          error={deleteError}
          onCancel={() => {
            if (!deleteBusy) setDeleteTarget(undefined)
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  )
})
