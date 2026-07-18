import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { BrowserWindow, dialog } from 'electron'
import type { PrintToPDFOptions } from 'electron'

import type {
  ExportDocumentResult,
  ExportHtmlRequest,
  ExportPdfRequest,
} from '../shared/desktop-api.types'

const MAX_EXPORT_HTML_BYTES = 100 * 1024 * 1024

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

function defaultExportPath(request: ExportHtmlRequest, extension: 'html' | 'pdf'): string {
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
}

function e2eExportPath(extension: 'html' | 'pdf'): string | undefined {
  if (process.env.OPENMD_E2E !== '1' || !process.env.OPENMD_E2E_EXPORT_DIR) return undefined
  return join(process.env.OPENMD_E2E_EXPORT_DIR, `openmd-export.${extension}`)
}

async function chooseExportPath(
  parentWindow: BrowserWindow,
  request: ExportHtmlRequest,
  extension: 'html' | 'pdf',
): Promise<string | undefined> {
  const testPath = e2eExportPath(extension)
  if (testPath) {
    await mkdir(dirname(testPath), { recursive: true })
    return testPath
  }

  const selection = await dialog.showSaveDialog(parentWindow, {
    title: extension === 'html' ? '导出独立 HTML' : '导出 PDF',
    defaultPath: defaultExportPath(request, extension),
    filters: [
      extension === 'html'
        ? { name: 'HTML 文档', extensions: ['html', 'htm'] }
        : { name: 'PDF 文档', extensions: ['pdf'] },
    ],
  })
  return selection.canceled ? undefined : selection.filePath
}

async function waitForImages(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    Promise.all(Array.from(document.images, (image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 5000);
      });
    }))
  `)
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

      printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      })
      printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      await printWindow.loadFile(temporaryHtmlPath)
      await waitForImages(printWindow)

      const printOptions: PrintToPDFOptions = {
        pageSize: request.pageSize,
        margins: request.margins,
        printBackground: request.printBackground,
        preferCSSPageSize: false,
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
}
