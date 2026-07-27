import { useEffect, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import type { WorkspaceEntry } from '../../../shared/desktop-api.types'
import { validateWorkspaceEntryName } from './workspace-entry-utils'
import type { EntryDialogMode } from './workspace-entry-utils'

interface EntryNameDialogProps {
  mode: EntryDialogMode
  entry?: WorkspaceEntry
  initialValue?: string
  onCancel: () => void
  onConfirm: (name: string) => Promise<string | undefined>
}

const titles: Record<EntryDialogMode, string> = {
  'create-file': '新建 Markdown 文件',
  'create-directory': '新建文件夹',
  rename: '重命名',
}

export function WorkspaceEntryNameDialog({
  mode,
  entry,
  initialValue = '',
  onCancel,
  onConfirm,
}: EntryNameDialogProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialValue)
  const [submitting, setSubmitting] = useState(false)
  const [backendError, setBackendError] = useState<string>()
  const validationError = validateWorkspaceEntryName(value, mode, entry)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (validationError || submitting) return
    setSubmitting(true)
    setBackendError(undefined)
    const error = await onConfirm(value.trim())
    if (error) {
      setBackendError(error)
      setSubmitting(false)
    }
  }

  return (
    <div
      className="entry-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel()
      }}
    >
      <form
        className="entry-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-dialog-title"
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !submitting) {
            event.preventDefault()
            onCancel()
          }
        }}
      >
        <h2 id="entry-dialog-title">{titles[mode]}</h2>
        <label>
          <span>名称</span>
          <input
            ref={inputRef}
            value={value}
            aria-invalid={Boolean(validationError || backendError)}
            aria-describedby="entry-dialog-message"
            onChange={(event) => {
              setValue(event.currentTarget.value)
              setBackendError(undefined)
            }}
          />
        </label>
        <p
          id="entry-dialog-message"
          className="entry-dialog-message"
          data-error={Boolean(validationError || backendError)}
          aria-live="polite"
        >
          {backendError ??
            validationError ??
            (mode === 'create-file' ? '省略扩展名时会自动添加 .md。' : '按 Enter 确认。')}
        </p>
        <div className="entry-dialog-actions">
          <button type="button" disabled={submitting} onClick={onCancel}>
            取消
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={Boolean(validationError) || submitting}
          >
            {submitting ? '处理中…' : '确认'}
          </button>
        </div>
      </form>
    </div>
  )
}

interface DeleteConfirmationProps {
  entry: WorkspaceEntry
  busy: boolean
  error?: string
  onCancel: () => void
  onConfirm: () => void
}

export function WorkspaceDeleteConfirmation({
  entry,
  busy,
  error,
  onCancel,
  onConfirm,
}: DeleteConfirmationProps): JSX.Element {
  return (
    <div className="entry-dialog-backdrop" role="presentation">
      <section
        className="entry-name-dialog delete-confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-entry-title"
        aria-describedby="delete-entry-detail"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onCancel()
        }}
      >
        <h2 id="delete-entry-title">将“{entry.name}”移到系统回收站？</h2>
        <p id="delete-entry-detail">
          {entry.kind === 'directory'
            ? '文件夹及其中内容将由系统移入回收站。'
            : '文件将由系统移入回收站。'}
        </p>
        {error ? (
          <p className="entry-dialog-message" data-error="true" role="alert">
            {error}
          </p>
        ) : null}
        <div className="entry-dialog-actions">
          <button type="button" autoFocus disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? '正在移入…' : '移到回收站'}
          </button>
        </div>
      </section>
    </div>
  )
}
