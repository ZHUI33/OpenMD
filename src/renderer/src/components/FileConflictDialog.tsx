import { useMemo, useState } from 'react'
import type { JSX } from 'react'

export type FileConflictAction = 'reload' | 'keep'

export interface FileConflictDialogProps {
  fileName: string
  currentMarkdown: string
  diskMarkdown?: string
  deleted?: boolean
  onResolve: (action: FileConflictAction) => void
}

interface ComparedLine {
  number: number
  current?: string
  disk?: string
  changed: boolean
}

interface LineComparison {
  lines: ComparedLine[]
  truncated: boolean
}

const MAX_COMPARED_LINES = 2_000

function compareLines(currentMarkdown: string, diskMarkdown: string): LineComparison {
  const currentLines = currentMarkdown.split(/\r\n|\r|\n/)
  const diskLines = diskMarkdown.split(/\r\n|\r|\n/)
  const length = Math.max(currentLines.length, diskLines.length)
  return {
    lines: Array.from({ length: Math.min(length, MAX_COMPARED_LINES) }, (_, index) => ({
      number: index + 1,
      current: currentLines[index],
      disk: diskLines[index],
      changed: currentLines[index] !== diskLines[index],
    })),
    truncated: length > MAX_COMPARED_LINES,
  }
}

export function FileConflictDialog({
  fileName,
  currentMarkdown,
  diskMarkdown,
  deleted = false,
  onResolve,
}: FileConflictDialogProps): JSX.Element {
  const [comparing, setComparing] = useState(false)
  const comparison = useMemo(
    () =>
      comparing && !deleted
        ? compareLines(currentMarkdown, diskMarkdown ?? '')
        : { lines: [], truncated: false },
    [comparing, currentMarkdown, deleted, diskMarkdown],
  )

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-conflict-title"
      >
        <header>
          <div>
            <h2 id="file-conflict-title">{deleted ? '文件已被删除' : '检测到外部修改'}</h2>
            <p>
              {deleted
                ? `“${fileName}”已从磁盘删除，当前标签中的内容仍然保留。`
                : `“${fileName}”在 OpenMD 外部发生了变化。`}
            </p>
          </div>
        </header>

        {comparing && !deleted ? (
          <div className="conflict-comparison" aria-label="内容差异">
            <div className="comparison-heading">
              <span>当前内容</span>
              <span>磁盘内容</span>
            </div>
            <div className="comparison-lines">
              {comparison.lines.map((line) => (
                <div key={line.number} className="comparison-row" data-changed={line.changed}>
                  <pre>
                    <span>{line.number}</span>
                    {line.current ?? ''}
                  </pre>
                  <pre>
                    <span>{line.number}</span>
                    {line.disk ?? ''}
                  </pre>
                </div>
              ))}
              {comparison.truncated ? (
                <p className="comparison-truncated">
                  文档较大，仅显示前 {MAX_COMPARED_LINES} 行；选择重新加载或保留内容不会截断文档。
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <footer className="dialog-actions">
          {!deleted ? (
            <button type="button" onClick={() => setComparing((value) => !value)}>
              {comparing ? '收起差异' : '比较差异'}
            </button>
          ) : null}
          <span className="dialog-action-spacer" />
          <button type="button" onClick={() => onResolve('keep')}>
            保留当前内容
          </button>
          {!deleted ? (
            <button className="primary-button" type="button" onClick={() => onResolve('reload')}>
              从磁盘重新加载
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  )
}
