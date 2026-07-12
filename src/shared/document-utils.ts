export const UNTITLED_DOCUMENT_NAME = '未命名'

export function getFileNameFromPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined

  const segments = filePath.split(/[\\/]/).filter(Boolean)
  return segments.at(-1)
}

export function formatDocumentTitle(filePath: string | undefined, dirty: boolean): string {
  const name = getFileNameFromPath(filePath) ?? UNTITLED_DOCUMENT_NAME
  return `${dirty ? '● ' : ''}${name} - OpenMD`
}
