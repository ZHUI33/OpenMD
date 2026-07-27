import type {
  ExportTheme,
  HtmlExportStyle,
  HtmlImageStrategy,
  PdfPageSize,
} from '../../shared/desktop-api.types'

export type ExportConfiguration =
  | {
      mode: 'html'
      title: string
      imageStrategy: HtmlImageStrategy
      style: HtmlExportStyle
    }
  | {
      mode: 'pdf'
      title: string
      pageSize: PdfPageSize
      marginMm: number
      printBackground: boolean
      theme: ExportTheme
      headerText: string
      footerText: string
      pageNumbers: boolean
      pageBreakBeforeHeadings: boolean
    }
  | {
      mode: 'png'
      title: string
      width: number
      theme: ExportTheme
    }

interface StoredExportPreferences {
  version: 1
  order: string[]
  configurations: Record<string, ExportConfiguration>
}

const STORAGE_KEY = 'openmd:document-export-preferences:v1'
const MAX_DOCUMENT_CONFIGURATIONS = 100

export function exportDocumentIdentity(tabId: string, filePath?: string): string {
  if (!filePath) return `tab:${tabId}`
  const normalized = filePath.replace(/\\/gu, '/')
  return /^(?:[a-z]:|\/\/)/iu.test(normalized)
    ? `path:${normalized.toLocaleLowerCase('en-US')}`
    : `path:${normalized}`
}

function readPreferences(storage: Pick<Storage, 'getItem'>): StoredExportPreferences {
  try {
    const parsed = JSON.parse(
      storage.getItem(STORAGE_KEY) ?? '',
    ) as Partial<StoredExportPreferences>
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.order) ||
      !parsed.configurations ||
      typeof parsed.configurations !== 'object'
    ) {
      throw new Error('Invalid export preferences')
    }
    return {
      version: 1,
      order: parsed.order.filter((key): key is string => typeof key === 'string'),
      configurations: parsed.configurations,
    }
  } catch {
    return { version: 1, order: [], configurations: {} }
  }
}

export function loadExportConfiguration(
  documentIdentity: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): ExportConfiguration | undefined {
  return readPreferences(storage).configurations[documentIdentity]
}

export function saveExportConfiguration(
  documentIdentity: string,
  configuration: ExportConfiguration,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): void {
  const preferences = readPreferences(storage)
  const order = [
    documentIdentity,
    ...preferences.order.filter((key) => key !== documentIdentity),
  ].slice(0, MAX_DOCUMENT_CONFIGURATIONS)
  const allowed = new Set(order)
  const configurations = Object.fromEntries(
    Object.entries({
      ...preferences.configurations,
      [documentIdentity]: configuration,
    }).filter(([key]) => allowed.has(key)),
  )
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, order, configurations }))
}
