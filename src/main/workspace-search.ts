import { opendir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import type {
  WorkspaceQuickOpenMatch,
  WorkspaceQuickOpenRequest,
  WorkspaceQuickOpenResult,
  WorkspaceSearchMatch,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '../shared/desktop-api.types'
import { isIgnoredWorkspaceEntry, toWorkspaceRelativePath } from './workspace-paths'

export const DEFAULT_WORKSPACE_SEARCH_LIMIT = 500
export const MAX_WORKSPACE_SEARCH_LIMIT = 1_000
export const MAX_WORKSPACE_SEARCH_FILES = 25_000
export const MAX_SEARCHABLE_FILE_BYTES = 2 * 1024 * 1024

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const TEXT_EXTENSIONS = new Set(['.txt'])

function normalizeForSearch(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase()
}

function createExcerpt(line: string, matchIndex: number, queryLength: number): string {
  const maximumLength = 240
  if (line.length <= maximumLength) return line

  const context = Math.max(32, Math.floor((maximumLength - queryLength) / 2))
  const start = Math.max(0, Math.min(matchIndex - context, line.length - maximumLength))
  const end = Math.min(line.length, start + maximumLength)
  return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`
}

export interface ParsedContentMatch {
  lineNumber: number
  column: number
  excerpt: string
}

export function parseWorkspaceContentMatches(
  content: string,
  query: string,
  caseSensitive = false,
  maximumMatches = Number.POSITIVE_INFINITY,
): ParsedContentMatch[] {
  if (!query || maximumMatches <= 0) return []

  const normalizedQuery = normalizeForSearch(query, caseSensitive)
  const matches: ParsedContentMatch[] = []
  const lines = content.split(/\r\n|\r|\n/)

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const normalizedLine = normalizeForSearch(line, caseSensitive)
    let fromIndex = 0

    while (fromIndex <= normalizedLine.length - normalizedQuery.length) {
      const matchIndex = normalizedLine.indexOf(normalizedQuery, fromIndex)
      if (matchIndex < 0) break
      matches.push({
        lineNumber: lineIndex + 1,
        column: matchIndex + 1,
        excerpt: createExcerpt(line, matchIndex, query.length),
      })
      if (matches.length >= maximumMatches) return matches
      fromIndex = matchIndex + Math.max(1, normalizedQuery.length)
    }
  }

  return matches
}

function isSearchableFile(filePath: string, includeTextFiles: boolean): boolean {
  const extension = extname(filePath).toLocaleLowerCase('en-US')
  return MARKDOWN_EXTENSIONS.has(extension) || (includeTextFiles && TEXT_EXTENSIONS.has(extension))
}

export function fuzzyFileScore(value: string, query: string): number | undefined {
  const candidate = value.normalize('NFKC').toLocaleLowerCase()
  const needle = query.normalize('NFKC').trim().toLocaleLowerCase()
  if (!needle) return 0

  let score = 0
  let candidateIndex = 0
  let previousMatch = -2
  for (const character of needle) {
    const matchIndex = candidate.indexOf(character, candidateIndex)
    if (matchIndex < 0) return undefined
    const boundary =
      matchIndex === 0 || /[\\/_.\-\s]/u.test(candidate.charAt(Math.max(0, matchIndex - 1)))
    score += boundary ? 18 : 4
    if (matchIndex === previousMatch + 1) score += 12
    score -= Math.min(8, matchIndex - candidateIndex)
    previousMatch = matchIndex
    candidateIndex = matchIndex + 1
  }
  return score - Math.max(0, candidate.length - needle.length) * 0.05
}

function normalizedSearchLimit(requestedLimit: number | undefined): number {
  if (requestedLimit === undefined || !Number.isFinite(requestedLimit)) {
    return DEFAULT_WORKSPACE_SEARCH_LIMIT
  }
  return Math.max(1, Math.min(MAX_WORKSPACE_SEARCH_LIMIT, Math.floor(requestedLimit)))
}

function immediate(): Promise<void> {
  return new Promise((resolveImmediate) => setImmediate(resolveImmediate))
}

export function decodeSearchableText(bytes: Uint8Array): string | undefined {
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 8_192))
  if (sample.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

export async function searchWorkspaceFiles(
  rootPath: string,
  request: WorkspaceSearchRequest,
  signal?: AbortSignal,
): Promise<WorkspaceSearchResult> {
  const query = request.query
  if (!query) return { matches: [], truncated: false, filesSearched: 0 }

  const root = await realpath(rootPath)
  const caseSensitive = request.caseSensitive ?? false
  const includeTextFiles = request.includeTextFiles ?? false
  const normalizedQuery = normalizeForSearch(query, caseSensitive)
  const resultLimit = normalizedSearchLimit(request.maxResults)
  const matches: WorkspaceSearchMatch[] = []
  const directories = [root]
  let filesSearched = 0
  let truncated = false

  while (directories.length > 0) {
    if (signal?.aborted) {
      return { matches, truncated, filesSearched, canceled: true }
    }

    const directoryPath = directories.pop()
    if (!directoryPath) break

    let directory
    try {
      directory = await opendir(directoryPath)
    } catch {
      continue
    }

    for await (const entry of directory) {
      if (signal?.aborted) {
        return { matches, truncated, filesSearched, canceled: true }
      }
      if (isIgnoredWorkspaceEntry(entry.name) || entry.isSymbolicLink()) continue

      const entryPath = join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
        continue
      }
      if (!entry.isFile() || !isSearchableFile(entryPath, includeTextFiles)) continue

      filesSearched += 1
      if (filesSearched > MAX_WORKSPACE_SEARCH_FILES) {
        truncated = true
        return { matches, truncated, filesSearched: MAX_WORKSPACE_SEARCH_FILES }
      }

      const relativePath = toWorkspaceRelativePath(root, entryPath)
      const normalizedName = normalizeForSearch(entry.name, caseSensitive)
      const fileNameIndex = normalizedName.indexOf(normalizedQuery)
      if (fileNameIndex >= 0) {
        matches.push({
          kind: 'filename',
          filePath: entryPath,
          relativePath,
          column: fileNameIndex + 1,
          excerpt: entry.name,
        })
      }

      if (matches.length >= resultLimit) {
        return { matches: matches.slice(0, resultLimit), truncated: true, filesSearched }
      }

      try {
        const fileStats = await stat(entryPath)
        if (fileStats.size <= MAX_SEARCHABLE_FILE_BYTES) {
          const content = decodeSearchableText(await readFile(entryPath))
          if (content !== undefined) {
            const contentMatches = parseWorkspaceContentMatches(
              content,
              query,
              caseSensitive,
              resultLimit - matches.length,
            )
            for (const match of contentMatches) {
              matches.push({
                kind: 'content',
                filePath: entryPath,
                relativePath,
                lineNumber: match.lineNumber,
                column: match.column,
                excerpt: match.excerpt,
              })
            }
          }
        }
      } catch {
        // Files may disappear or become unreadable while a search is in progress.
      }

      if (matches.length >= resultLimit) {
        return { matches: matches.slice(0, resultLimit), truncated: true, filesSearched }
      }
      if (filesSearched % 4 === 0) await immediate()
    }
  }

  return { matches, truncated, filesSearched }
}

export async function searchWorkspaceFileNames(
  rootPath: string,
  request: WorkspaceQuickOpenRequest,
  signal?: AbortSignal,
): Promise<WorkspaceQuickOpenResult> {
  const root = await realpath(rootPath)
  const includeTextFiles = request.includeTextFiles ?? false
  const resultLimit = normalizedSearchLimit(request.maxResults)
  const directories = [root]
  const matches: WorkspaceQuickOpenMatch[] = []
  let filesScanned = 0
  let truncated = false

  while (directories.length > 0) {
    if (signal?.aborted) return { matches: [], filesScanned, truncated, canceled: true }
    const directoryPath = directories.pop()
    if (!directoryPath) break

    let directory
    try {
      directory = await opendir(directoryPath)
    } catch {
      continue
    }

    for await (const entry of directory) {
      if (signal?.aborted) return { matches: [], filesScanned, truncated, canceled: true }
      if (isIgnoredWorkspaceEntry(entry.name) || entry.isSymbolicLink()) continue
      const entryPath = join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
        continue
      }
      if (!entry.isFile() || !isSearchableFile(entryPath, includeTextFiles)) continue

      filesScanned += 1
      if (filesScanned > MAX_WORKSPACE_SEARCH_FILES) {
        truncated = true
        break
      }
      const relativePath = toWorkspaceRelativePath(root, entryPath)
      const nameScore = fuzzyFileScore(entry.name, request.query)
      const pathScore = fuzzyFileScore(relativePath, request.query)
      const score =
        nameScore === undefined
          ? pathScore
          : pathScore === undefined
            ? nameScore + 30
            : Math.max(nameScore + 30, pathScore)
      if (score !== undefined) {
        matches.push({
          filePath: entryPath,
          relativePath,
          name: entry.name,
          score,
        })
      }
      if (filesScanned % 128 === 0) await immediate()
    }
    if (truncated) break
  }

  matches.sort(
    (left, right) =>
      right.score - left.score ||
      left.name.localeCompare(right.name) ||
      left.relativePath.localeCompare(right.relativePath),
  )
  return {
    matches: matches.slice(0, resultLimit),
    filesScanned: Math.min(filesScanned, MAX_WORKSPACE_SEARCH_FILES),
    truncated: truncated || matches.length > resultLimit,
  }
}

export function searchResultFileName(match: WorkspaceSearchMatch): string {
  return basename(match.filePath)
}
