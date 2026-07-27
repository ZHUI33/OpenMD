import { useEffect, useRef } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import { APP_COMMANDS } from '../../../shared/commands'
import type { DocumentSearchQuery, DocumentSearchStatus } from '../editor/editor.types'

export interface FindReplaceBarProps {
  open: boolean
  replaceVisible: boolean
  value: DocumentSearchQuery
  status: DocumentSearchStatus
  onChange: (query: DocumentSearchQuery) => void
  onNext: (direction: 1 | -1) => void
  onReplace: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function FindReplaceBar({
  open,
  replaceVisible,
  value,
  status,
  onChange,
  onNext,
  onReplace,
  onReplaceAll,
  onClose,
}: FindReplaceBarProps): JSX.Element | null {
  const queryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      queryInputRef.current?.focus()
      queryInputRef.current?.select()
    })
  }, [open, replaceVisible])

  if (!open) return null

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onNext(event.shiftKey ? -1 : 1)
    }
  }

  return (
    <section
      className="document-find-bar"
      aria-label={replaceVisible ? APP_COMMANDS.replace.label : APP_COMMANDS.find.label}
      data-replace-visible={replaceVisible}
    >
      <div className="document-find-bar__query">
        <input
          ref={queryInputRef}
          type="text"
          aria-label="查找内容"
          placeholder="查找"
          value={value.query}
          onChange={(event) => onChange({ ...value, query: event.currentTarget.value })}
          onKeyDown={handleInputKeyDown}
        />
        <span className="document-find-bar__count" aria-live="polite">
          {status.error ? '表达式无效' : `${status.current}/${status.total}`}
        </span>
      </div>
      <div className="document-find-bar__actions">
        <button type="button" aria-label="上一项" onClick={() => onNext(-1)}>
          ↑
        </button>
        <button type="button" aria-label="下一项" onClick={() => onNext(1)}>
          ↓
        </button>
        {(
          [
            ['caseSensitive', 'Aa', '区分大小写'],
            ['wholeWord', '词', '全词匹配'],
            ['regularExpression', '.*', '正则表达式'],
          ] as const
        ).map(([field, text, label]) => (
          <button
            key={field}
            type="button"
            aria-label={label}
            aria-pressed={value[field]}
            onClick={() => onChange({ ...value, [field]: !value[field] })}
          >
            {text}
          </button>
        ))}
        <button type="button" aria-label="关闭查找" onClick={onClose}>
          ×
        </button>
      </div>
      {replaceVisible ? (
        <div className="document-find-bar__replace">
          <input
            type="text"
            aria-label="替换为"
            placeholder="替换为"
            value={value.replacement}
            onChange={(event) => onChange({ ...value, replacement: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'Enter') onReplace()
            }}
          />
          <button type="button" onClick={onReplace}>
            替换
          </button>
          <button type="button" onClick={onReplaceAll}>
            全部替换
          </button>
        </div>
      ) : null}
      {status.error ? (
        <span className="document-find-bar__error" role="alert">
          {status.error}
        </span>
      ) : null}
    </section>
  )
}
