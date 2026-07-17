export interface AppInfo {
  name: string
  version: string
  platform: string
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
}

export interface SaveDocumentResult {
  canceled: boolean
  filePath?: string
  error?: boolean
}

export interface ConfirmCloseRequest {
  filePath?: string
  content: string
}

export type ConfirmCloseAction = 'save' | 'discard' | 'cancel'

export interface ConfirmCloseResult {
  action: ConfirmCloseAction
  filePath?: string
}

export interface RecentFile {
  path: string
  name: string
  lastOpenedAt: number
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
  | { type: 'reload' }
  | { type: 'close'; intent: CloseIntent; requestId: string }

export type EditorCommand =
  | { type: 'toggle-editor-mode' }
  | { type: 'toggle-source-line-numbers' }
  | { type: 'toggle-source-line-wrapping' }

export type RendererCommand = DocumentCommand | EditorCommand

export interface DocumentsApi {
  ready: () => Promise<void>
  newDocument: () => Promise<NewDocumentResult>
  openDocument: (request?: OpenDocumentRequest) => Promise<OpenDocumentResult>
  saveDocument: (request: SaveDocumentRequest) => Promise<SaveDocumentResult>
  confirmClose: (request: ConfirmCloseRequest) => Promise<ConfirmCloseResult>
  reload: () => Promise<void>
  resolveClose: (request: ResolveCloseRequest) => Promise<void>
  onCommand: (listener: (command: RendererCommand) => void) => () => void
}

export interface OpenMdApi {
  getAppInfo: () => Promise<AppInfo>
  documents: DocumentsApi
  images: ImagesApi
}
