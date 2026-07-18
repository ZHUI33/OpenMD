import { useEffect, useId, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import type { HtmlImageStrategy, PdfPageSize } from '../../../shared/desktop-api.types'
import './ExportDialog.css'

export interface PdfExportOptions {
  pageSize: PdfPageSize
  marginMm: number
  printBackground: boolean
}

export interface ExportDialogProps {
  mode?: 'html' | 'pdf'
  defaultTitle: string
  busy?: boolean
  error?: string
  onClose: () => void
  onExportHtml: (title: string, imageStrategy: HtmlImageStrategy) => void
  onExportPdf: (title: string, options: PdfExportOptions) => void
}

export function ExportDialog({
  mode = 'html',
  defaultTitle,
  busy = false,
  error,
  onClose,
  onExportHtml,
  onExportPdf,
}: ExportDialogProps): JSX.Element {
  const titleId = useId()
  const [title, setTitle] = useState(defaultTitle)
  const [imageStrategy, setImageStrategy] = useState<HtmlImageStrategy>('relative')
  const [pageSize, setPageSize] = useState<PdfPageSize>('A4')
  const [marginMm, setMarginMm] = useState(20)
  const [printBackground, setPrintBackground] = useState(true)

  useEffect(() => setTitle(defaultTitle), [defaultTitle, mode])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [busy, onClose])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) return
    if (mode === 'html') onExportHtml(title.trim() || defaultTitle, imageStrategy)
    else onExportPdf(title.trim() || defaultTitle, { pageSize, marginMm, printBackground })
  }

  return (
    <div className="export-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="export-dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header>
          <div>
            <p className="export-dialog__eyebrow">导出正文</p>
            <h2 id={titleId}>{mode === 'html' ? '独立 HTML' : 'PDF 文档'}</h2>
          </div>
          <button type="button" aria-label="关闭导出设置" disabled={busy} onClick={onClose}>
            ×
          </button>
        </header>

        <label className="export-dialog__field">
          <span>文档标题</span>
          <input
            autoFocus
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>

        {mode === 'html' ? (
          <fieldset>
            <legend>图片策略</legend>
            <label>
              <input
                type="radio"
                name="image-strategy"
                checked={imageStrategy === 'relative'}
                onChange={() => setImageStrategy('relative')}
              />
              <span>引用相对资源</span>
            </label>
            <label>
              <input
                type="radio"
                name="image-strategy"
                checked={imageStrategy === 'base64'}
                onChange={() => setImageStrategy('base64')}
              />
              <span>嵌入 Base64（本地图片）</span>
            </label>
          </fieldset>
        ) : (
          <div className="export-dialog__pdf-grid">
            <label className="export-dialog__field">
              <span>纸张</span>
              <select
                value={pageSize}
                onChange={(event) =>
                  setPageSize(event.currentTarget.value === 'Letter' ? 'Letter' : 'A4')
                }
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
              </select>
            </label>
            <label className="export-dialog__field">
              <span>页边距（mm）</span>
              <input
                type="number"
                min="0"
                max="50"
                step="1"
                value={marginMm}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  setMarginMm(Number.isFinite(value) ? value : 0)
                }}
              />
            </label>
            <label className="export-dialog__check">
              <input
                type="checkbox"
                checked={printBackground}
                onChange={(event) => setPrintBackground(event.currentTarget.checked)}
              />
              <span>显示背景</span>
            </label>
          </div>
        )}

        <p className="export-dialog__hint">
          {mode === 'html'
            ? '导出文件不包含脚本、Electron 或 Node.js 代码。远程图片会继续使用 HTTPS 地址。'
            : 'PDF 使用浅色打印主题，仅包含文档正文。'}
        </p>
        {error ? <p className="export-dialog__error">{error}</p> : null}

        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={busy || !Number.isFinite(marginMm)}>
            {busy ? '正在导出…' : '选择保存位置'}
          </button>
        </footer>
      </form>
    </div>
  )
}
