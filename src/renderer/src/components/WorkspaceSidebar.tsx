import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { WorkspaceApi, WorkspaceEntry, WorkspaceInfo } from '../../../shared/desktop-api.types'

export interface WorkspaceSidebarProps {
  api: WorkspaceApi
  workspace?: WorkspaceInfo
  selectedFilePath?: string
  includeTextFiles: boolean
  searchVisible: boolean
  onOpenWorkspace: () => void
  onOpenFile: (entry: WorkspaceEntry) => void
  onEntryRenamed?: (previous: WorkspaceEntry, renamed: WorkspaceEntry) => void
  onEntryDeleted?: (entry: WorkspaceEntry) => void
  onSearchVisibleChange: (visible: boolean) => void
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
              data-selected={entry.filePath === selectedPath}
              style={{ paddingInlineStart: `${10 + depth * 14}px` }}
              title={entry.relativePath}
              onClick={() => {
                onSelect(entry)
                if (isDirectory) onToggle(entry)
              }}
            >
              <span className="tree-chevron" aria-hidden="true">
                {isDirectory
                  ? loading.has(entry.relativePath)
                    ? '…'
                    : isExpanded
                      ? '▾'
                      : '▸'
                  : ''}
              </span>
              <span className="tree-entry-icon" aria-hidden="true">
                {isDirectory ? (isExpanded ? '▣' : '□') : entry.kind === 'markdown' ? 'M' : 'T'}
              </span>
              <span className="tree-entry-name">{entry.name}</span>
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

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  api,
  workspace,
  selectedFilePath,
  includeTextFiles,
  searchVisible,
  onOpenWorkspace,
  onOpenFile,
  onEntryRenamed,
  onEntryDeleted,
  onSearchVisibleChange,
  onError,
}: WorkspaceSidebarProps): JSX.Element {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [selectedEntry, setSelectedEntry] = useState<WorkspaceEntry | undefined>()
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})
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
        onError(error instanceof Error ? error.message : '无法读取工作区目录。')
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
    treeGenerationRef.current += 1
    directoryRequestIdsRef.current.clear()
    if (workspace) void loadDirectory(ROOT_KEY)
  }, [loadDirectory, workspace])

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

  const createMarkdown = async (): Promise<void> => {
    const name = window.prompt('新建 Markdown 文件', '未命名.md')?.trim()
    if (!name) return
    try {
      const entry = await api.createMarkdownFile({
        parentRelativePath: operationParent || undefined,
        name,
      })
      setExpanded((current) => new Set(current).add(operationParent))
      await loadDirectory(operationParent)
      setSelectedEntry(entry)
      onOpenFile(entry)
    } catch (error) {
      onError(error instanceof Error ? error.message : '新建 Markdown 文件失败。')
    }
  }

  const createDirectory = async (): Promise<void> => {
    const name = window.prompt('新建文件夹')?.trim()
    if (!name) return
    try {
      await api.createDirectory({ parentRelativePath: operationParent || undefined, name })
      setExpanded((current) => new Set(current).add(operationParent))
      await loadDirectory(operationParent)
    } catch (error) {
      onError(error instanceof Error ? error.message : '新建文件夹失败。')
    }
  }

  const renameSelected = async (): Promise<void> => {
    if (!selectedEntry) return
    const newName = window.prompt('重命名', selectedEntry.name)?.trim()
    if (!newName || newName === selectedEntry.name) return
    try {
      const renamed = await api.renameEntry({
        relativePath: selectedEntry.relativePath,
        newName,
      })
      onEntryRenamed?.(selectedEntry, renamed)
      setSelectedEntry(renamed)
      await loadDirectory(parentPath(selectedEntry.relativePath))
    } catch (error) {
      onError(error instanceof Error ? error.message : '重命名失败。')
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (!selectedEntry) return
    try {
      const result = await api.deleteEntry({ relativePath: selectedEntry.relativePath })
      if (!result.deleted) return
      onEntryDeleted?.(selectedEntry)
      setSelectedEntry(undefined)
      await loadDirectory(parentPath(selectedEntry.relativePath))
    } catch (error) {
      onError(error instanceof Error ? error.message : '删除失败。')
    }
  }

  return (
    <aside className="workspace-sidebar" aria-label="工作区文件">
      <header className="workspace-sidebar-header">
        <div>
          <span className="sidebar-kicker">工作区</span>
          <strong title={workspace?.rootPath}>{workspace?.name ?? '尚未打开文件夹'}</strong>
        </div>
        <button type="button" title="打开文件夹 (Ctrl/Cmd+Shift+O)" onClick={onOpenWorkspace}>
          打开
        </button>
      </header>

      {workspace ? (
        <>
          <div className="workspace-toolbar" aria-label="文件操作">
            <button type="button" title="新建 Markdown 文件" onClick={() => void createMarkdown()}>
              +M
            </button>
            <button type="button" title="新建文件夹" onClick={() => void createDirectory()}>
              +□
            </button>
            <button
              type="button"
              title="重命名"
              disabled={!selectedEntry}
              onClick={() => void renameSelected()}
            >
              改
            </button>
            <button
              type="button"
              title="删除"
              disabled={!selectedEntry}
              onClick={() => void deleteSelected()}
            >
              删
            </button>
            <button
              type="button"
              title="在系统文件管理器中显示"
              disabled={!selectedEntry}
              onClick={() =>
                selectedEntry && void api.revealEntry({ relativePath: selectedEntry.relativePath })
              }
            >
              ↗
            </button>
            <button
              type="button"
              title="复制相对路径"
              disabled={!selectedEntry}
              onClick={() =>
                selectedEntry &&
                void api.copyRelativePath({ relativePath: selectedEntry.relativePath })
              }
            >
              ⧉
            </button>
            <button type="button" title="刷新" onClick={() => void refresh()}>
              ↻
            </button>
            <button
              type="button"
              data-active={searchVisible}
              title="全文搜索 (Ctrl/Cmd+Shift+F)"
              onClick={() => onSearchVisibleChange(!searchVisible)}
            >
              ⌕
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
                selectedPath={selectedFilePath}
                visibleCounts={visibleCounts}
                onSelect={(entry) => {
                  setSelectedEntry(entry)
                  if (entry.kind !== 'directory') onOpenFile(entry)
                }}
                onToggle={toggleDirectory}
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
          <span aria-hidden="true">◇</span>
          <p>打开一个本地文件夹，浏览 Markdown 文档并进行全文搜索。</p>
          <button className="primary-button" type="button" onClick={onOpenWorkspace}>
            打开文件夹
          </button>
        </div>
      )}
    </aside>
  )
})
