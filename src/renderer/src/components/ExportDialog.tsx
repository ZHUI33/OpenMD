import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import type {
  ExportTheme,
  HtmlExportStyle,
  HtmlImageStrategy,
  PdfPageSize,
} from '../../../shared/desktop-api.types'
import type { ExportConfiguration } from '../export-preferences'
import { useDialogFocus } from './use-dialog-focus'
import './ExportDialog.css'

export interface PdfExportOptions {
  pageSize: PdfPageSize
  marginMm: number
  printBackground: boolean
  theme: ExportTheme
  headerText: string
  footerText: string
  pageNumbers: boolean
  pageBreakBeforeHeadings: boolean
}

export interface PngExportOptions {
  width: number
  theme: ExportTheme
}

export interface ExportDialogProps {
  mode?: 'html' | 'pdf' | 'png'
  defaultTitle: string
  initialConfiguration?: ExportConfiguration
  busy?: boolean
  error?: string
  onClose: () => void
  onExportHtml: (title: string, imageStrategy: HtmlImageStrategy, style: HtmlExportStyle) => void
  onExportPdf: (title: string, options: PdfExportOptions) => void
  onExportPng: (title: string, options: PngExportOptions) => void
}

export function ExportDialog({
  mode = 'html',
  defaultTitle,
  initialConfiguration,
  busy = false,
  error,
  onClose,
  onExportHtml,
  onExportPdf,
  onExportPng,
}: ExportDialogProps): JSX.Element {
  const titleId = useId()
  const dialogRef = useRef<HTMLFormElement>(null)
  const [title, setTitle] = useState(defaultTitle)
  const [imageStrategy, setImageStrategy] = useState<HtmlImageStrategy>('relative')
  const [htmlStyle, setHtmlStyle] = useState<HtmlExportStyle>('styled')
  const [pageSize, setPageSize] = useState<PdfPageSize>('A4')
  const [marginMm, setMarginMm] = useState(20)
  const [printBackground, setPrintBackground] = useState(true)
  const [theme, setTheme] = useState<ExportTheme>('light')
  const [headerText, setHeaderText] = useState('')
  const [footerText, setFooterText] = useState('')
  const [pageNumbers, setPageNumbers] = useState(true)
  const [pageBreakBeforeHeadings, setPageBreakBeforeHeadings] = useState(false)
  const [pngWidth, setPngWidth] = useState(1_000)

  useDialogFocus(dialogRef)

  useEffect(() => {
    setTitle(initialConfiguration?.title ?? defaultTitle)
    if (initialConfiguration?.mode === 'html') {
      setImageStrategy(initialConfiguration.imageStrategy)
      setHtmlStyle(initialConfiguration.style)
    } else if (initialConfiguration?.mode === 'pdf') {
      setPageSize(initialConfiguration.pageSize)
      setMarginMm(initialConfiguration.marginMm)
      setPrintBackground(initialConfiguration.printBackground)
      setTheme(initialConfiguration.theme)
      setHeaderText(initialConfiguration.headerText)
      setFooterText(initialConfiguration.footerText)
      setPageNumbers(initialConfiguration.pageNumbers)
      setPageBreakBeforeHeadings(initialConfiguration.pageBreakBeforeHeadings)
    } else if (initialConfiguration?.mode === 'png') {
      setPngWidth(initialConfiguration.width)
      setTheme(initialConfiguration.theme)
    }
  }, [defaultTitle, initialConfiguration, mode])
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
    const exportTitle = title.trim() || defaultTitle
    if (mode === 'html') onExportHtml(exportTitle, imageStrategy, htmlStyle)
    else if (mode === 'pdf') {
      onExportPdf(exportTitle, {
        pageSize,
        marginMm,
        printBackground,
        theme,
        headerText,
        footerText,
        pageNumbers,
        pageBreakBeforeHeadings,
      })
    } else onExportPng(exportTitle, { width: pngWidth, theme })
  }

  return (
    <div className="export-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        ref={dialogRef}
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
            <h2 id={titleId}>
              {mode === 'html' ? 'HTML 文档' : mode === 'pdf' ? 'PDF 文档' : '长图 PNG'}
            </h2>
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
          <>
            <fieldset>
              <legend>HTML 样式</legend>
              <label>
                <input
                  type="radio"
                  name="html-style"
                  checked={htmlStyle === 'styled'}
                  onChange={() => setHtmlStyle('styled')}
                />
                <span>包含 OpenMD 阅读样式</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="html-style"
                  checked={htmlStyle === 'unstyled'}
                  onChange={() => setHtmlStyle('unstyled')}
                />
                <span>无样式语义 HTML</span>
              </label>
            </fieldset>
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
          </>
        ) : mode === 'pdf' ? (
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
            <label className="export-dialog__field">
              <span>主题</span>
              <select
                aria-label="PDF 主题"
                value={theme}
                onChange={(event) =>
                  setTheme(event.currentTarget.value === 'dark' ? 'dark' : 'light')
                }
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label className="export-dialog__field export-dialog__field--wide">
              <span>页眉</span>
              <input
                maxLength={500}
                value={headerText}
                onChange={(event) => setHeaderText(event.currentTarget.value)}
              />
            </label>
            <label className="export-dialog__field export-dialog__field--wide">
              <span>页脚</span>
              <input
                maxLength={500}
                value={footerText}
                onChange={(event) => setFooterText(event.currentTarget.value)}
              />
            </label>
            <label className="export-dialog__check">
              <input
                type="checkbox"
                checked={pageNumbers}
                onChange={(event) => setPageNumbers(event.currentTarget.checked)}
              />
              <span>显示页码</span>
            </label>
            <label className="export-dialog__check">
              <input
                type="checkbox"
                checked={pageBreakBeforeHeadings}
                onChange={(event) => setPageBreakBeforeHeadings(event.currentTarget.checked)}
              />
              <span>一级/二级标题前分页</span>
            </label>
          </div>
        ) : (
          <div className="export-dialog__pdf-grid">
            <label className="export-dialog__field">
              <span>图片宽度（px）</span>
              <input
                type="number"
                min="480"
                max="2400"
                step="20"
                value={pngWidth}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  setPngWidth(Number.isFinite(value) ? value : 1_000)
                }}
              />
            </label>
            <label className="export-dialog__field">
              <span>主题</span>
              <select
                aria-label="PNG 主题"
                value={theme}
                onChange={(event) =>
                  setTheme(event.currentTarget.value === 'dark' ? 'dark' : 'light')
                }
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
          </div>
        )}

        <p className="export-dialog__hint">
          {mode === 'html'
            ? '导出文件不包含脚本、Electron 或 Node.js 代码。远程图片会继续使用 HTTPS 地址。'
            : mode === 'pdf'
              ? '页眉、页脚仅作为纯文本处理；Markdown 或 YAML 不会触发命令。'
              : '生成单张纵向 PNG；超出安全像素上限时会停止并提示拆分文档。'}
        </p>
        {error ? <p className="export-dialog__error">{error}</p> : null}

        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={
              busy ||
              !Number.isFinite(marginMm) ||
              !Number.isFinite(pngWidth) ||
              (mode === 'png' && (pngWidth < 480 || pngWidth > 2_400))
            }
          >
            {busy ? '正在导出…' : '选择保存位置'}
          </button>
        </footer>
      </form>
    </div>
  )
}
