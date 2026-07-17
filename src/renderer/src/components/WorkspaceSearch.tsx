import { memo, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type {
  WorkspaceApi,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from '../../../shared/desktop-api.types'

export interface WorkspaceSearchProps {
  api: WorkspaceApi
  includeTextFiles: boolean
  onOpenResult: (match: WorkspaceSearchMatch) => void
  onClose: () => void
}

const EMPTY_RESULT: WorkspaceSearchResult = {
  matches: [],
  truncated: false,
  filesSearched: 0,
}

export const WorkspaceSearch = memo(function WorkspaceSearch({
  api,
  includeTextFiles,
  onOpenResult,
  onClose,
}: WorkspaceSearchProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestIdRef = useRef(0)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<WorkspaceSearchResult>(EMPTY_RESULT)
  const [error, setError] = useState<string>()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setSearching(false)
      setResult(EMPTY_RESULT)
      setError(undefined)
      return
    }

    setSearching(true)
    const timer = window.setTimeout(() => {
      void api
        .search({
          query: trimmedQuery,
          caseSensitive,
          includeTextFiles,
          maxResults: 500,
        })
        .then((nextResult) => {
          if (requestId !== requestIdRef.current) return
          setResult(nextResult)
          setError(undefined)
        })
        .catch((searchError: unknown) => {
          if (requestId !== requestIdRef.current) return
          setResult(EMPTY_RESULT)
          setError(searchError instanceof Error ? searchError.message : '搜索失败。')
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setSearching(false)
        })
    }, 220)

    return () => window.clearTimeout(timer)
  }, [api, caseSensitive, includeTextFiles, query])

  return (
    <section className="workspace-search" aria-label="工作区搜索">
      <header className="search-header">
        <strong>全文搜索</strong>
        <button type="button" aria-label="关闭搜索" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="search-controls">
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="搜索文件名和 Markdown 正文"
          aria-label="搜索工作区"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
          }}
        />
        <label title="区分大小写">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.currentTarget.checked)}
          />
          Aa
        </label>
      </div>
      <div className="search-summary" aria-live="polite">
        {error
          ? error
          : searching
            ? '正在搜索…'
            : query.trim()
              ? `${result.matches.length} 条结果 · 已检查 ${result.filesSearched} 个文件${result.truncated ? ' · 已达到上限' : ''}`
              : '输入关键词开始搜索'}
      </div>
      <div className="search-results">
        {result.matches.map((match, index) => (
          <button
            key={`${match.relativePath}:${match.kind}:${match.lineNumber ?? 0}:${index}`}
            className="search-result"
            type="button"
            onClick={() => onOpenResult(match)}
          >
            <span className="search-result-path">
              {match.relativePath}
              {match.lineNumber ? `:${match.lineNumber}` : ''}
            </span>
            <span className="search-result-kind">
              {match.kind === 'filename' ? '文件名' : '正文'}
            </span>
            <span className="search-result-excerpt">{match.excerpt}</span>
          </button>
        ))}
      </div>
    </section>
  )
})
