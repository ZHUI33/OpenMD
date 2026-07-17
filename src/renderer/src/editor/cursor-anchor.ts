import type { CursorAnchor } from './editor.types'

interface MarkdownLine {
  from: number
  text: string
}

const HEADING_PATTERN = /^ {0,3}#{1,6}[\t ]+(.+?)[\t ]*#*[\t ]*$/
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/

function getLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = []
  let from = 0

  for (const text of markdown.split(/\r\n|\r|\n/)) {
    lines.push({ from, text })
    const lineBreak = markdown.slice(from + text.length).match(/^(?:\r\n|\r|\n)/)?.[0] ?? ''
    from += text.length + lineBreak.length
  }
  return lines
}

export function getMarkdownBlockOffsets(markdown: string): number[] {
  const lines = getLines(markdown)
  const offsets: number[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]!
    if (!line.text.trim()) {
      index += 1
      continue
    }

    offsets.push(line.from)
    const fence = line.text.match(FENCE_PATTERN)?.[1]
    if (fence) {
      index += 1
      const closingFence = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[\\t ]*$`)
      while (index < lines.length) {
        const current = lines[index++]!
        if (closingFence.test(current.text)) break
      }
      continue
    }

    if (HEADING_PATTERN.test(line.text)) {
      index += 1
      continue
    }

    index += 1
    while (index < lines.length) {
      const current = lines[index]!
      if (
        !current.text.trim() ||
        HEADING_PATTERN.test(current.text) ||
        FENCE_PATTERN.test(current.text)
      ) {
        break
      }
      index += 1
    }
  }

  return offsets
}

export function findHeadingBeforeOffset(markdown: string, offset: number): string | undefined {
  let result: string | undefined
  for (const line of getLines(markdown)) {
    if (line.from > offset) break
    const heading = line.text.match(HEADING_PATTERN)?.[1]?.trim()
    if (heading) result = heading
  }
  return result
}

export function findHeadingOffset(
  markdown: string,
  headingText: string,
  blockIndex?: number,
): number | undefined {
  const matches: number[] = []
  for (const line of getLines(markdown)) {
    if (line.text.match(HEADING_PATTERN)?.[1]?.trim() === headingText) matches.push(line.from)
  }
  if (matches.length === 0) return undefined
  if (blockIndex === undefined) return matches[0]

  const blockOffsets = getMarkdownBlockOffsets(markdown)
  const targetOffset =
    blockOffsets[Math.max(0, Math.min(blockIndex, blockOffsets.length - 1))] ?? matches[0]!
  return matches.reduce((nearest, offset) =>
    Math.abs(offset - targetOffset) < Math.abs(nearest - targetOffset) ? offset : nearest,
  )
}

export function createSourceCursorAnchor(markdown: string, offset: number): CursorAnchor {
  const boundedOffset = Math.max(0, Math.min(offset, markdown.length))
  const blockOffsets = getMarkdownBlockOffsets(markdown)
  let blockIndex = 0

  for (let index = 0; index < blockOffsets.length; index += 1) {
    if (blockOffsets[index]! > boundedOffset) break
    blockIndex = index
  }

  return {
    offset: boundedOffset,
    headingText: findHeadingBeforeOffset(markdown, boundedOffset),
    blockIndex: blockOffsets.length > 0 ? blockIndex : undefined,
  }
}

export function resolveSourceCursorOffset(markdown: string, anchor: CursorAnchor): number {
  if (anchor.offset !== undefined) return Math.max(0, Math.min(anchor.offset, markdown.length))

  if (anchor.blockIndex !== undefined) {
    const blockOffsets = getMarkdownBlockOffsets(markdown)
    if (blockOffsets.length > 0) {
      return blockOffsets[Math.max(0, Math.min(anchor.blockIndex, blockOffsets.length - 1))]!
    }
  }

  if (anchor.headingText) {
    const headingOffset = findHeadingOffset(markdown, anchor.headingText)
    if (headingOffset !== undefined) return headingOffset
  }

  return 0
}
