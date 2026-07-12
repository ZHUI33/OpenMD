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

export interface DocumentsApi {
  ready: () => Promise<void>
  newDocument: () => Promise<NewDocumentResult>
  openDocument: (request?: OpenDocumentRequest) => Promise<OpenDocumentResult>
  saveDocument: (request: SaveDocumentRequest) => Promise<SaveDocumentResult>
  confirmClose: (request: ConfirmCloseRequest) => Promise<ConfirmCloseResult>
  reload: () => Promise<void>
  resolveClose: (request: ResolveCloseRequest) => Promise<void>
  onCommand: (listener: (command: DocumentCommand) => void) => () => void
}

export interface OpenMdApi {
  getAppInfo: () => Promise<AppInfo>
  documents: DocumentsApi
}
