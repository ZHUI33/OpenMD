import type { AppSettings, AppSettingsUpdate } from './settings'
import type { LoadedUserTheme, UserThemeInfo } from './theme'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export type HtmlImageStrategy = 'relative' | 'base64'
export type PdfPageSize = 'A4' | 'Letter'

export interface ExportHtmlRequest {
  documentHtml: string
  documentPath?: string
  title: string
}

export interface PdfMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ExportPdfRequest extends ExportHtmlRequest {
  pageSize: PdfPageSize
  margins: PdfMargins
  printBackground: boolean
}

export interface ExportDocumentResult {
  canceled: boolean
  filePath?: string
  error?: string
}

export interface OpenDocumentRequest {
  filePath?: string
}

export interface OpenDocumentResult {
  canceled: boolean
  filePath?: string
  content?: string
  error?: boolean
}

export interface NewDocumentResult {
  content: string
}

export interface SaveDocumentRequest {
  filePath?: string
  content: string
  saveAs?: boolean
  forbiddenFilePaths?: string[]
}

export interface SaveDocumentResult {
  canceled: boolean
  filePath?: string
  error?: boolean
}

export interface ConfirmCloseRequest {
  filePath?: string
  content: string
  forbiddenFilePaths?: string[]
}

export type ConfirmCloseAction = 'save' | 'discard' | 'cancel'

export interface ConfirmCloseResult {
  action: ConfirmCloseAction
  filePath?: string
}

export interface ReleaseDocumentRequest {
  filePath: string
}

export interface RecentFile {
  path: string
  name: string
  lastOpenedAt: number
}

export interface WorkspaceInfo {
  name: string
  rootPath: string
}

export interface OpenWorkspaceResult {
  canceled: boolean
  workspace?: WorkspaceInfo
}

export type WorkspaceEntryKind = 'directory' | 'markdown' | 'text'

export interface WorkspaceEntry {
  name: string
  relativePath: string
  filePath: string
  kind: WorkspaceEntryKind
}

export interface WorkspacePathRequest {
  relativePath: string
}

export interface ListWorkspaceDirectoryRequest {
  relativePath?: string
  includeTextFiles?: boolean
}

export interface WorkspaceFileResult {
  filePath: string
  relativePath: string
  content: string
}

export interface CreateWorkspaceEntryRequest {
  parentRelativePath?: string
  name: string
}

export interface RenameWorkspaceEntryRequest {
  relativePath: string
  newName: string
}

export interface DeleteWorkspaceEntryResult {
  deleted: boolean
}

export interface WorkspaceSearchRequest {
  query: string
  caseSensitive?: boolean
  includeTextFiles?: boolean
  maxResults?: number
}

export interface WorkspaceSearchMatch {
  kind: 'filename' | 'content'
  filePath: string
  relativePath: string
  lineNumber?: number
  column?: number
  excerpt: string
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[]
  truncated: boolean
  filesSearched: number
  canceled?: boolean
}

export interface WorkspaceFileChange {
  type: 'changed' | 'deleted'
  filePath: string
  relativePath: string
  mtimeMs?: number
  content?: string
}

export interface WorkspaceApi {
  open: () => Promise<OpenWorkspaceResult>
  getCurrent: () => Promise<WorkspaceInfo | undefined>
  listDirectory: (request?: ListWorkspaceDirectoryRequest) => Promise<WorkspaceEntry[]>
  readFile: (request: WorkspacePathRequest) => Promise<WorkspaceFileResult>
  createMarkdownFile: (request: CreateWorkspaceEntryRequest) => Promise<WorkspaceEntry>
  createDirectory: (request: CreateWorkspaceEntryRequest) => Promise<WorkspaceEntry>
  renameEntry: (request: RenameWorkspaceEntryRequest) => Promise<WorkspaceEntry>
  deleteEntry: (request: WorkspacePathRequest) => Promise<DeleteWorkspaceEntryResult>
  revealEntry: (request: WorkspacePathRequest) => Promise<void>
  copyRelativePath: (request: WorkspacePathRequest) => Promise<void>
  search: (request: WorkspaceSearchRequest) => Promise<WorkspaceSearchResult>
  onFileChange: (listener: (change: WorkspaceFileChange) => void) => () => void
}

export interface SettingsApi {
  get: () => Promise<AppSettings>
  update: (update: AppSettingsUpdate) => Promise<AppSettings>
  reset: () => Promise<AppSettings>
  listUserThemes: () => Promise<UserThemeInfo[]>
  loadUserTheme: (themeId: string) => Promise<LoadedUserTheme>
}

export type ImageErrorCode =
  | 'document-not-saved'
  | 'unauthorized-document'
  | 'invalid-request'
  | 'unsupported-image'
  | 'image-too-large'
  | 'invalid-path'
  | 'image-not-found'
  | 'read-failed'
  | 'write-failed'
  | 'unsafe-svg'

export interface ImageOperationError {
  code: ImageErrorCode
  message: string
}

export interface SaveImageRequest {
  documentPath: string
  bytes: Uint8Array
  suggestedName?: string
}

export interface SelectImageRequest {
  documentPath: string
}

export interface SaveImageResult {
  canceled: boolean
  relativePath?: string
  displayUrl?: string
  error?: ImageOperationError
}

export interface ResolveImageRequest {
  documentPath: string
  source: string
}

export interface ResolveImageResult {
  ok: boolean
  url?: string
  pathHint?: string
  error?: ImageOperationError
}

export interface ImagesApi {
  saveImage: (request: SaveImageRequest) => Promise<SaveImageResult>
  selectImage: (request: SelectImageRequest) => Promise<SaveImageResult>
  resolveImage: (request: ResolveImageRequest) => Promise<ResolveImageResult>
}

export type CloseIntent = 'window' | 'application'

export interface ResolveCloseRequest {
  intent: CloseIntent
  requestId: string
  proceed: boolean
}

export type DocumentCommand =
  | { type: 'new' }
  | { type: 'open' }
  | { type: 'open-recent'; filePath: string }
  | { type: 'save' }
  | { type: 'save-as' }
  | { type: 'export-html' }
  | { type: 'export-pdf' }
  | { type: 'reload' }
  | { type: 'close'; intent: CloseIntent; requestId: string }

export type EditorCommand =
  | { type: 'toggle-editor-mode' }
  | { type: 'toggle-source-line-numbers' }
  | { type: 'toggle-source-line-wrapping' }

export type WorkspaceCommand = { type: 'open-workspace' } | { type: 'search-workspace' }

export type RendererCommand = DocumentCommand | EditorCommand | WorkspaceCommand

export interface DocumentsApi {
  ready: () => Promise<void>
  newDocument: () => Promise<NewDocumentResult>
  openDocument: (request?: OpenDocumentRequest) => Promise<OpenDocumentResult>
  saveDocument: (request: SaveDocumentRequest) => Promise<SaveDocumentResult>
  confirmClose: (request: ConfirmCloseRequest) => Promise<ConfirmCloseResult>
  releaseDocument: (request: ReleaseDocumentRequest) => Promise<void>
  reload: () => Promise<void>
  resolveClose: (request: ResolveCloseRequest) => Promise<void>
  onCommand: (listener: (command: RendererCommand) => void) => () => void
}

export interface OpenMdApi {
  getAppInfo: () => Promise<AppInfo>
  documents: DocumentsApi
  images: ImagesApi
  workspace: WorkspaceApi
  settings: SettingsApi
  exports: {
    html: (request: ExportHtmlRequest) => Promise<ExportDocumentResult>
    pdf: (request: ExportPdfRequest) => Promise<ExportDocumentResult>
  }
}
