import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { BrowserWindow, dialog } from 'electron'
import type { PrintToPDFOptions } from 'electron'

import type {
  ExportDocumentResult,
  ExportHtmlRequest,
  ExportPdfRequest,
  ExportPngRequest,
} from '../shared/desktop-api.types'

const MAX_EXPORT_HTML_BYTES = 100 * 1024 * 1024
const MAX_PNG_HEIGHT = 32_000
const MAX_PNG_PIXELS = 80_000_000

function safeBaseName(request: ExportHtmlRequest): string {
  const fromDocument = request.documentPath
    ? basename(request.documentPath, extname(request.documentPath))
    : request.title
  const value = Array.from(fromDocument.replace(/[<>:"/\\|?*]/gu, '-'))
    .map((character) => ((character.codePointAt(0) ?? 0) <= 0x1f ? '-' : character))
    .join('')
    .trim()
  return value.slice(0, 160) || 'OpenMD-document'
}

function defaultExportPath(request: ExportHtmlRequest, extension: 'html' | 'pdf' | 'png'): string {
  const fileName = `${safeBaseName(request)}.${extension}`
  return request.documentPath ? join(dirname(request.documentPath), fileName) : fileName
}

function validateStandaloneHtml(documentHtml: string): void {
  if (Buffer.byteLength(documentHtml, 'utf8') > MAX_EXPORT_HTML_BYTES) {
    throw new TypeError('导出内容超过 100 MB 限制。')
  }
  if (!/^<!doctype html>/iu.test(documentHtml.trimStart())) {
    throw new TypeError('导出内容不是独立 HTML 文档。')
  }
  if (/<\s*(?:script|iframe|object|embed)\b/iu.test(documentHtml)) {
    throw new TypeError('导出内容包含不安全的可执行标签。')
  }
  if (
    /\son[a-z]+\s*=/iu.test(documentHtml) ||
    /(?:href|src)\s*=\s*["']\s*javascript:/iu.test(documentHtml)
  ) {
    throw new TypeError('导出内容包含不安全的事件或链接。')
  }
  if (!/<meta[^>]+http-equiv=["']Content-Security-Policy["']/iu.test(documentHtml)) {
    throw new TypeError('导出内容缺少 Content Security Policy。')
  }
}

function e2eExportPath(extension: 'html' | 'pdf' | 'png'): string | undefined {
  if (process.env.OPENMD_E2E !== '1' || !process.env.OPENMD_E2E_EXPORT_DIR) return undefined
  return join(process.env.OPENMD_E2E_EXPORT_DIR, `openmd-export.${extension}`)
}

async function chooseExportPath(
  parentWindow: BrowserWindow,
  request: ExportHtmlRequest,
  extension: 'html' | 'pdf' | 'png',
): Promise<string | undefined> {
  const testPath = e2eExportPath(extension)
  if (testPath) {
    await mkdir(dirname(testPath), { recursive: true })
    return testPath
  }

  const selection = await dialog.showSaveDialog(parentWindow, {
    title: extension === 'html' ? '导出 HTML' : extension === 'pdf' ? '导出 PDF' : '导出长图 PNG',
    defaultPath: defaultExportPath(request, extension),
    filters: [
      extension === 'html'
        ? { name: 'HTML 文档', extensions: ['html', 'htm'] }
        : extension === 'pdf'
          ? { name: 'PDF 文档', extensions: ['pdf'] }
          : { name: 'PNG 图片', extensions: ['png'] },
    ],
  })
  return selection.canceled ? undefined : selection.filePath
}

async function waitForImages(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...Array.from(document.images, (image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 5000);
      });
      })
    ])
  `)
}

function escapeTemplateText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function printTemplate(text: string, includePageNumbers: boolean): string {
  const safeText = escapeTemplateText(text.trim())
  const pageNumber = includePageNumbers
    ? '<span class="pageNumber"></span><span aria-hidden="true"> / </span><span class="totalPages"></span>'
    : ''
  return `<div style="box-sizing:border-box;width:100%;padding:0 12mm;color:#666;font:9px system-ui,sans-serif;display:flex;justify-content:space-between;gap:12px"><span>${safeText}</span><span>${pageNumber}</span></div>`
}

function createExportWindow(width = 1_200, height = 800): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    frame: false,
    useContentSize: true,
    width,
    height,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  return window
}

export class ExportService {
  async exportHtml(
    parentWindow: BrowserWindow,
    request: ExportHtmlRequest,
  ): Promise<ExportDocumentResult> {
    try {
      validateStandaloneHtml(request.documentHtml)
      const filePath = await chooseExportPath(parentWindow, request, 'html')
      if (!filePath) return { canceled: true }
      await writeFile(filePath, request.documentHtml, { encoding: 'utf8', mode: 0o600 })
      return { canceled: false, filePath }
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'HTML 导出失败。',
      }
    }
  }

  async exportPdf(
    parentWindow: BrowserWindow,
    request: ExportPdfRequest,
  ): Promise<ExportDocumentResult> {
    let printWindow: BrowserWindow | undefined
    let temporaryDirectory: string | undefined
    try {
      validateStandaloneHtml(request.documentHtml)
      const filePath = await chooseExportPath(parentWindow, request, 'pdf')
      if (!filePath) return { canceled: true }

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-pdf-'))
      const temporaryHtmlPath = join(temporaryDirectory, 'document.html')
      await writeFile(temporaryHtmlPath, request.documentHtml, { encoding: 'utf8', mode: 0o600 })

      printWindow = createExportWindow()
      await printWindow.loadFile(temporaryHtmlPath)
      await waitForImages(printWindow)

      const printOptions: PrintToPDFOptions = {
        pageSize: request.pageSize,
        margins: request.margins,
        printBackground: request.printBackground,
        preferCSSPageSize: false,
        displayHeaderFooter:
          request.pageNumbers || Boolean(request.headerText.trim() || request.footerText.trim()),
        headerTemplate: printTemplate(request.headerText, false),
        footerTemplate: printTemplate(request.footerText, request.pageNumbers),
      }
      const pdf = await printWindow.webContents.printToPDF(printOptions)
      await writeFile(filePath, pdf, { mode: 0o600 })
      return { canceled: false, filePath }
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'PDF 导出失败。',
      }
    } finally {
      if (printWindow && !printWindow.isDestroyed()) printWindow.destroy()
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  async exportPng(
    parentWindow: BrowserWindow,
    request: ExportPngRequest,
  ): Promise<ExportDocumentResult> {
    let captureWindow: BrowserWindow | undefined
    let temporaryDirectory: string | undefined
    try {
      validateStandaloneHtml(request.documentHtml)
      const filePath = await chooseExportPath(parentWindow, request, 'png')
      if (!filePath) return { canceled: true }

      temporaryDirectory = await mkdtemp(join(tmpdir(), 'openmd-png-'))
      const temporaryHtmlPath = join(temporaryDirectory, 'document.html')
      await writeFile(temporaryHtmlPath, request.documentHtml, { encoding: 'utf8', mode: 0o600 })
      captureWindow = createExportWindow(request.width, 900)
      await captureWindow.loadFile(temporaryHtmlPath)
      const scrollbarWidth = (await captureWindow.webContents.executeJavaScript(
        'Math.max(0, window.innerWidth - document.documentElement.clientWidth)',
      )) as number
      if (scrollbarWidth > 0) {
        captureWindow.setContentSize(request.width + Math.ceil(scrollbarWidth), 900)
        await captureWindow.webContents.executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        )
      }
      await waitForImages(captureWindow)

      const dimensions = (await captureWindow.webContents.executeJavaScript(
        `({
          width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
          height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
        })`,
      )) as { width: number; height: number }
      const width = Math.max(1, Math.min(request.width, Math.ceil(dimensions.width)))
      const height = Math.max(1, Math.ceil(dimensions.height))
      if (height > MAX_PNG_HEIGHT || width * height > MAX_PNG_PIXELS) {
        throw new TypeError(
          `长图尺寸 ${width}×${height} 超过安全上限（高度 ${MAX_PNG_HEIGHT}px、总计 ${MAX_PNG_PIXELS.toLocaleString('en-US')} 像素）。请缩小宽度或拆分文档。`,
        )
      }

      captureWindow.setContentSize(request.width, height)
      await captureWindow.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      )
      const image = await captureWindow.webContents.capturePage({ x: 0, y: 0, width, height })
      if (image.isEmpty()) throw new Error('页面截图为空。')
      const imageSize = image.getSize()
      if (imageSize.width !== width || imageSize.height !== height) {
        throw new Error(
          `页面截图被系统截断为 ${imageSize.width}×${imageSize.height}，预期 ${width}×${height}。请缩小宽度或拆分文档。`,
        )
      }
      await writeFile(filePath, image.toPNG(), { mode: 0o600 })
      return { canceled: false, filePath }
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'PNG 导出失败。',
      }
    } finally {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy()
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }
}
