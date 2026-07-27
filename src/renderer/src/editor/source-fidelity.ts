export interface SourceReconciliation {
  markdown: string
  changed: boolean
  normalizedRange?: {
    from: number
    to: number
  }
  sourceRange?: {
    from: number
    to: number
  }
}

type DiffKind = 'equal' | 'delete' | 'insert'

interface DiffPart {
  kind: DiffKind
  text: string
}

interface NormalizedSource {
  text: string
  /** Maps every normalized UTF-16 boundary back to the original source. */
  boundaries: number[]
}

interface BoundaryAlignment {
  lower: number[]
  upper: number[]
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return index
}

function commonSuffixLength(left: string, right: string, prefixLength = 0): number {
  const limit = Math.min(left.length, right.length) - prefixLength
  let length = 0
  while (
    length < limit &&
    left.charCodeAt(left.length - length - 1) === right.charCodeAt(right.length - length - 1)
  ) {
    length += 1
  }
  return length
}

function pushDiff(parts: DiffPart[], kind: DiffKind, character: string): void {
  const previous = parts.at(-1)
  if (previous?.kind === kind) previous.text += character
  else parts.push({ kind, text: character })
}

/**
 * Myers' shortest-edit-script algorithm. This path only aligns the serializer's
 * previous output with the same document's original spelling, so its edit
 * distance is normally small even for large documents.
 */
function diffCharacters(left: string, right: string): DiffPart[] {
  if (left === right) return left ? [{ kind: 'equal', text: left }] : []
  if (!left) return [{ kind: 'insert', text: right }]
  if (!right) return [{ kind: 'delete', text: left }]

  const prefixLength = commonPrefixLength(left, right)
  const suffixLength = commonSuffixLength(left, right, prefixLength)
  const prefix = left.slice(0, prefixLength)
  const suffix = suffixLength ? left.slice(left.length - suffixLength) : ''
  const leftMiddle = left.slice(prefixLength, left.length - suffixLength)
  const rightMiddle = right.slice(prefixLength, right.length - suffixLength)

  if (!leftMiddle || !rightMiddle) {
    return [
      ...(prefix ? [{ kind: 'equal' as const, text: prefix }] : []),
      ...(leftMiddle ? [{ kind: 'delete' as const, text: leftMiddle }] : []),
      ...(rightMiddle ? [{ kind: 'insert' as const, text: rightMiddle }] : []),
      ...(suffix ? [{ kind: 'equal' as const, text: suffix }] : []),
    ]
  }

  const leftLength = leftMiddle.length
  const rightLength = rightMiddle.length
  const maximumDistance = leftLength + rightLength
  const diagonal = new Map<number, number>([[1, 0]])
  const trace: Array<Map<number, number>> = []
  let finalDistance = maximumDistance

  outer: for (let distance = 0; distance <= maximumDistance; distance += 1) {
    trace.push(new Map(diagonal))
    for (let k = -distance; k <= distance; k += 2) {
      const down = diagonal.get(k + 1) ?? Number.NEGATIVE_INFINITY
      const rightward = diagonal.get(k - 1) ?? Number.NEGATIVE_INFINITY
      let x =
        k === -distance || (k !== distance && rightward < down) ? Math.max(0, down) : rightward + 1
      let y = x - k
      while (
        x < leftLength &&
        y < rightLength &&
        leftMiddle.charCodeAt(x) === rightMiddle.charCodeAt(y)
      ) {
        x += 1
        y += 1
      }
      diagonal.set(k, x)
      if (x >= leftLength && y >= rightLength) {
        finalDistance = distance
        break outer
      }
    }
  }

  let x = leftLength
  let y = rightLength
  const reversed: DiffPart[] = []
  for (let distance = finalDistance; distance >= 0; distance -= 1) {
    const previousDiagonal = trace[distance]!
    const k = x - y
    const down = previousDiagonal.get(k + 1) ?? Number.NEGATIVE_INFINITY
    const rightward = previousDiagonal.get(k - 1) ?? Number.NEGATIVE_INFINITY
    const previousK = k === -distance || (k !== distance && rightward < down) ? k + 1 : k - 1
    const previousX = Math.max(0, previousDiagonal.get(previousK) ?? 0)
    const previousY = previousX - previousK

    while (x > previousX && y > previousY) {
      pushDiff(reversed, 'equal', leftMiddle.charAt(x - 1))
      x -= 1
      y -= 1
    }
    if (distance === 0) break

    if (x === previousX) {
      pushDiff(reversed, 'insert', rightMiddle.charAt(y - 1))
      y -= 1
    } else {
      pushDiff(reversed, 'delete', leftMiddle.charAt(x - 1))
      x -= 1
    }
  }

  const middle = reversed
    .reverse()
    .map((part) => ({ ...part, text: Array.from(part.text).reverse().join('') }))
    .reduce<DiffPart[]>((parts, part) => {
      const previous = parts.at(-1)
      if (previous?.kind === part.kind) previous.text += part.text
      else parts.push(part)
      return parts
    }, [])

  return [
    ...(prefix ? [{ kind: 'equal' as const, text: prefix }] : []),
    ...middle,
    ...(suffix ? [{ kind: 'equal' as const, text: suffix }] : []),
  ]
}

function normalizeSourceLineEndings(source: string): NormalizedSource {
  let text = ''
  const boundaries = [0]
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index)
    if (character === '\r') {
      if (source.charAt(index + 1) === '\n') index += 1
      text += '\n'
      boundaries.push(index + 1)
      continue
    }
    text += character
    boundaries.push(index + 1)
  }
  return { text, boundaries }
}

function alignBoundaries(serialized: string, source: string): BoundaryAlignment {
  const lower = new Array<number>(serialized.length + 1)
  const upper = new Array<number>(serialized.length + 1)
  let serializedPosition = 0
  let sourcePosition = 0
  lower[0] = 0
  upper[0] = 0

  for (const part of diffCharacters(serialized, source)) {
    if (part.kind === 'equal') {
      for (let offset = 0; offset <= part.text.length; offset += 1) {
        lower[serializedPosition + offset] = sourcePosition + offset
        upper[serializedPosition + offset] = sourcePosition + offset
      }
      serializedPosition += part.text.length
      sourcePosition += part.text.length
      continue
    }
    if (part.kind === 'delete') {
      for (let offset = 0; offset <= part.text.length; offset += 1) {
        lower[serializedPosition + offset] ??= sourcePosition
        upper[serializedPosition + offset] ??= sourcePosition
      }
      serializedPosition += part.text.length
      continue
    }

    lower[serializedPosition] ??= sourcePosition
    sourcePosition += part.text.length
    upper[serializedPosition] = sourcePosition
  }

  lower[serialized.length] ??= source.length
  upper[serialized.length] ??= source.length
  for (let index = 1; index <= serialized.length; index += 1) {
    lower[index] ??= lower[index - 1]!
    upper[index] ??= upper[index - 1]!
  }
  return { lower, upper }
}

function lineEndingAt(source: string, index: number): string | undefined {
  if (source.charAt(index) === '\r') return source.charAt(index + 1) === '\n' ? '\r\n' : '\r'
  if (source.charAt(index) === '\n') return '\n'
  return undefined
}

function preferredLineEnding(source: string, from: number, to: number): string {
  for (let index = from; index < to; index += 1) {
    const ending = lineEndingAt(source, index)
    if (ending) return ending
  }
  for (let distance = 0; distance < source.length; distance += 1) {
    const before = from - distance - 1
    if (before >= 0) {
      const start =
        source.charAt(before) === '\n' && source.charAt(before - 1) === '\r' ? before - 1 : before
      const ending = lineEndingAt(source, start)
      if (ending) return ending
    }
    const after = to + distance
    if (after < source.length) {
      const ending = lineEndingAt(source, after)
      if (ending) return ending
    }
  }
  return '\n'
}

function applyLineEnding(text: string, lineEnding: string): string {
  return lineEnding === '\n' ? text : text.replace(/\n/g, lineEnding)
}

/**
 * Reconciles an editor serializer update with the user's exact source.
 *
 * Milkdown/remark intentionally normalize Markdown spellings. We retain the
 * original spelling as the canonical source and transplant only the range
 * whose normalized representation changed. This keeps unrelated YAML, code
 * fences, raw HTML, whitespace, and mixed line endings byte-for-byte stable.
 */
export function reconcileSerializedMarkdown(
  source: string,
  previousSerialized: string,
  nextSerialized: string,
): SourceReconciliation {
  if (previousSerialized === nextSerialized) return { markdown: source, changed: false }

  const prefixLength = commonPrefixLength(previousSerialized, nextSerialized)
  const suffixLength = commonSuffixLength(previousSerialized, nextSerialized, prefixLength)
  const previousEnd = previousSerialized.length - suffixLength
  const nextEnd = nextSerialized.length - suffixLength

  const normalizedSource = normalizeSourceLineEndings(source)
  const alignment = alignBoundaries(previousSerialized, normalizedSource.text)
  const normalizedSourceFrom = alignment.upper[prefixLength] ?? 0
  const normalizedSourceTo = alignment.lower[previousEnd] ?? normalizedSource.text.length
  const normalizedFrom = Math.min(normalizedSourceFrom, normalizedSourceTo)
  const normalizedTo = Math.max(normalizedSourceFrom, normalizedSourceTo)
  const sourceFrom = normalizedSource.boundaries[normalizedFrom] ?? 0
  const sourceTo = normalizedSource.boundaries[normalizedTo] ?? source.length
  const lineEnding = preferredLineEnding(source, sourceFrom, sourceTo)
  const replacement = applyLineEnding(nextSerialized.slice(prefixLength, nextEnd), lineEnding)

  return {
    markdown: source.slice(0, sourceFrom) + replacement + source.slice(sourceTo),
    changed: true,
    normalizedRange: { from: prefixLength, to: previousEnd },
    sourceRange: { from: sourceFrom, to: sourceTo },
  }
}
