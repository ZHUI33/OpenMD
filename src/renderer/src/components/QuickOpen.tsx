import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import { APP_COMMANDS } from '../../../shared/commands'
import type {
  RecentFile,
  WorkspaceApi,
  WorkspaceQuickOpenMatch,
} from '../../../shared/desktop-api.types'
import { normalizeEditorTabPath } from '../stores/editor-tabs-store'

interface QuickOpenItem {
  key: string
  name: string
  detail: string
  filePath: string
  relativePath?: string
  recent: boolean
  score: number
}

export interface QuickOpenProps {
  open: boolean
  hasWorkspace: boolean
  includeTextFiles: boolean
  workspaceApi: WorkspaceApi
  getRecentFiles: () => Promise<RecentFile[]>
  onOpenWorkspaceFile: (relativePath: string) => void
  onOpenRecentFile: (filePath: string) => void
  onClose: () => void
}

function fuzzyScore(value: string, query: string): number | undefined {
  const candidate = value.normalize('NFKC').toLocaleLowerCase()
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase()
  if (!needle) return 0
  let score = 0
  let from = 0
  let previous = -2
  for (const character of needle) {
    const index = candidate.indexOf(character, from)
    if (index < 0) return undefined
    score += index === previous + 1 ? 12 : 3
    if (index === 0 || /[\\/_.\-\s]/u.test(candidate[index - 1] ?? '')) score += 18
    previous = index
    from = index + 1
  }
  return score
}

function mergeItems(
  recentFiles: readonly RecentFile[],
  workspaceMatches: readonly WorkspaceQuickOpenMatch[],
  query: string,
): QuickOpenItem[] {
  const byPath = new Map<string, QuickOpenItem>()
  for (const match of workspaceMatches) {
    byPath.set(normalizeEditorTabPath(match.filePath), {
      key: normalizeEditorTabPath(match.filePath),
      name: match.name,
      detail: match.relativePath,
      filePath: match.filePath,
      relativePath: match.relativePath,
      recent: false,
      score: match.score,
    })
  }
  for (const [index, recent] of recentFiles.entries()) {
    const score = fuzzyScore(`${recent.name} ${recent.path}`, query)
    if (score === undefined) continue
    const key = normalizeEditorTabPath(recent.path)
    const existing = byPath.get(key)
    byPath.set(key, {
      key,
      name: recent.name,
      detail: existing?.relativePath ?? recent.path,
      filePath: recent.path,
      relativePath: existing?.relativePath,
      recent: true,
      score: score + 1_000 - index,
    })
  }
  return [...byPath.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.localeCompare(right.name) ||
        left.detail.localeCompare(right.detail),
    )
    .slice(0, 100)
}

export function QuickOpen({
  open,
  hasWorkspace,
  includeTextFiles,
  workspaceApi,
  getRecentFiles,
  onOpenWorkspaceFile,
  onOpenRecentFile,
  onClose,
}: QuickOpenProps): JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const [query, setQuery] = useState('')
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [workspaceMatches, setWorkspaceMatches] = useState<WorkspaceQuickOpenMatch[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    setWorkspaceMatches([])
    void getRecentFiles()
      .then(setRecentFiles)
      .catch(() => setRecentFiles([]))
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [getRecentFiles, open])

  useEffect(() => {
    if (!open || !hasWorkspace) return
    const generation = ++generationRef.current
    setBusy(true)
    const timer = window.setTimeout(() => {
      void workspaceApi
        .quickOpen({ query, includeTextFiles, maxResults: 300 })
        .then((result) => {
          if (generation === generationRef.current && !result.canceled) {
            setWorkspaceMatches(result.matches)
          }
        })
        .catch(() => {
          if (generation === generationRef.current) setWorkspaceMatches([])
        })
        .finally(() => {
          if (generation === generationRef.current) setBusy(false)
        })
    }, 70)
    return () => {
      window.clearTimeout(timer)
      generationRef.current += 1
      void workspaceApi.cancelQuickOpen().catch(() => undefined)
    }
  }, [hasWorkspace, includeTextFiles, open, query, workspaceApi])

  const items = useMemo(
    () => mergeItems(recentFiles, workspaceMatches, query),
    [query, recentFiles, workspaceMatches],
  )

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(0, items.length - 1)))
  }, [items.length])

  if (!open) return null

  const openItem = (item: QuickOpenItem | undefined): void => {
    if (!item) return
    onClose()
    if (item.relativePath) onOpenWorkspaceFile(item.relativePath)
    else onOpenRecentFile(item.filePath)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => (items.length ? (current + 1) % items.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) =>
        items.length ? (current - 1 + items.length) % items.length : 0,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openItem(items[selectedIndex])
    }
  }

  return (
    <div
      className="quick-open-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="quick-open" role="dialog" aria-modal="true" aria-label="快速打开">
        <input
          ref={inputRef}
          className="quick-open__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="quick-open-results"
          aria-activedescendant={items[selectedIndex] ? `quick-open-${selectedIndex}` : undefined}
          placeholder={`${APP_COMMANDS['quick-open'].label}：输入文件名`}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setSelectedIndex(0)
          }}
          onKeyDown={onKeyDown}
        />
        <div className="quick-open__summary" aria-live="polite">
          {busy ? '正在搜索…' : `${items.length} 个文件`}
        </div>
        <div id="quick-open-results" className="quick-open__results" role="listbox">
          {items.map((item, index) => (
            <button
              id={`quick-open-${index}`}
              key={item.key}
              className="quick-open__result"
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              data-selected={index === selectedIndex}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => openItem(item)}
            >
              <span className="quick-open__name">
                {item.name}
                {item.recent ? <small>最近</small> : null}
              </span>
              <span className="quick-open__path">{item.detail}</span>
            </button>
          ))}
          {!busy && items.length === 0 ? (
            <p className="quick-open__empty">没有匹配的文件。</p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
