function escapeAltText(altText: string): string {
  return altText
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function escapeDestination(destination: string): string {
  return destination
    .replace(/\\/g, '/')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function encodeMarkdownPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function serializeMarkdownImage(altText: string, source: string): string {
  return `![${escapeAltText(altText)}](${escapeDestination(source)})`
}

export function encodeMarkdownPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').map(encodeMarkdownPathSegment).join('/')
}
