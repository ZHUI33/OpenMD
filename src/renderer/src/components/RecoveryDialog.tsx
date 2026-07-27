import { useEffect, useId, useRef } from 'react'
import type { JSX } from 'react'

import type { RecoverySnapshot, RecoveryTabSnapshot } from '../../../shared/desktop-api.types'
import { useDialogFocus } from './use-dialog-focus'

export interface RecoveryDialogProps {
  snapshot: RecoverySnapshot
  busy?: boolean
  onRestoreAll: () => void
  onRestoreTab: (tab: RecoveryTabSnapshot) => void
  onDiscard: () => void
}

function formatBackupTime(timestamp: number | undefined): string {
  if (!timestamp) return '仅恢复原文件标签'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp))
}

export function RecoveryDialog({
  snapshot,
  busy = false,
  onRestoreAll,
  onRestoreTab,
  onDiscard,
}: RecoveryDialogProps): JSX.Element {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useDialogFocus(dialogRef)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onDiscard()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onDiscard])

  return (
    <div className="recovery-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="recovery-dialog__eyebrow">本地崩溃恢复</p>
            <h2 id={titleId}>发现上次未正常结束的工作</h2>
          </div>
          {snapshot.workspace ? (
            <span className="recovery-dialog__workspace">工作区：{snapshot.workspace.name}</span>
          ) : null}
        </header>
        <p className="recovery-dialog__notice">
          恢复内容仅来自此设备的 Electron
          userData。修改稿会作为新副本打开，不会自动覆盖原文件，也不会上传。
        </p>

        <div className="recovery-dialog__records" aria-label="可恢复文档">
          {snapshot.tabs.map((tab) => (
            <article className="recovery-record" key={tab.id}>
              <div className="recovery-record__heading">
                <strong>{tab.title}</strong>
                <time
                  dateTime={tab.backedUpAt ? new Date(tab.backedUpAt).toISOString() : undefined}
                >
                  {formatBackupTime(tab.backedUpAt)}
                </time>
              </div>
              <div className="recovery-record__path">
                原路径：{tab.originalPath ?? '未命名文档'}
              </div>
              <p>{tab.summary ?? '此标签将从原路径重新打开。'}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRestoreTab(tab)}
                aria-label={`恢复 ${tab.title}`}
              >
                {tab.content !== undefined ? '恢复为副本' : '重新打开标签'}
              </button>
            </article>
          ))}
        </div>

        <footer>
          <button type="button" disabled={busy} onClick={onDiscard}>
            舍弃恢复记录
          </button>
          <button className="primary-button" type="button" disabled={busy} onClick={onRestoreAll}>
            {busy ? '正在恢复…' : '恢复工作区与全部标签'}
          </button>
        </footer>
      </section>
    </div>
  )
}
