import type {
  DocumentCommand,
  DocumentsApi,
  SaveDocumentResult,
} from '../../shared/desktop-api.types'
import type { OpenMdEditorHandle } from './editor/editor.types'
import { useAppStore } from './stores/app-store'

type GetEditor = () => OpenMdEditorHandle | null

export class DocumentController {
  private commandQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly documentsApi: DocumentsApi,
    private readonly getEditor: GetEditor,
  ) {}

  handleCommand(command: DocumentCommand): Promise<void> {
    const operation = this.commandQueue.then(() => this.executeCommand(command))
    this.commandQueue = operation.catch((error: unknown) => {
      console.error('Document command failed:', error)
    })
    return operation
  }

  /**
   * Ensure image ingestion has a stable document directory. This runs through
   * the same queue as menu commands, so concurrent Save/Save As requests cannot
   * open competing dialogs. A cancelled dialog resolves to undefined.
   */
  ensureDocumentSaved(): Promise<string | undefined> {
    const operation = this.commandQueue.then(async () => {
      const currentPath = useAppStore.getState().document.filePath
      if (currentPath) return currentPath

      const saved = await this.saveDocument(false)
      return saved ? useAppStore.getState().document.filePath : undefined
    })
    this.commandQueue = operation.then(
      () => undefined,
      (error: unknown) => {
        console.error('Document save required for image insertion failed:', error)
      },
    )
    return operation
  }

  private async executeCommand(command: DocumentCommand): Promise<void> {
    switch (command.type) {
      case 'new':
        await this.newDocument()
        break
      case 'open':
        await this.openDocument()
        break
      case 'open-recent':
        await this.openDocument(command.filePath)
        break
      case 'save':
        await this.saveDocument(false)
        break
      case 'save-as':
        await this.saveDocument(true)
        break
      case 'reload':
        await this.reload()
        break
      case 'close':
        await this.close(command.intent, command.requestId)
        break
    }
  }

  private getLatestMarkdown(): string {
    const markdown = this.getEditor()?.getMarkdown() ?? useAppStore.getState().document.markdown
    useAppStore.getState().updateMarkdown(markdown)
    return markdown
  }

  private replaceDocument(markdown: string, filePath?: string): void {
    this.getEditor()?.setMarkdown(markdown)
    useAppStore.getState().setDocument(markdown, filePath)
    this.getEditor()?.focus()
  }

  private applySaveResult(result: SaveDocumentResult, savedMarkdown: string): void {
    this.getLatestMarkdown()
    useAppStore.getState().applySaveResult(result, savedMarkdown)
  }

  private async withEditorLocked<T>(operation: () => Promise<T>): Promise<T> {
    const editor = this.getEditor()
    editor?.setReadOnly(true)
    try {
      return await operation()
    } finally {
      editor?.setReadOnly(false)
    }
  }

  private async saveDocument(saveAs: boolean): Promise<boolean> {
    const content = this.getLatestMarkdown()
    const { filePath } = useAppStore.getState().document
    let result: SaveDocumentResult

    try {
      result = await this.documentsApi.saveDocument({ filePath, content, saveAs })
    } catch (error) {
      useAppStore.getState().applySaveResult({ canceled: false, error: true }, content)
      throw error
    }

    this.applySaveResult(result, content)
    return !result.canceled && !result.error && Boolean(result.filePath)
  }

  private async confirmDocumentReplacement(): Promise<boolean> {
    while (true) {
      const content = this.getLatestMarkdown()
      const documentState = useAppStore.getState().document
      if (!documentState.dirty) return true

      const confirmation = await this.documentsApi.confirmClose({
        filePath: documentState.filePath,
        content,
      })

      if (confirmation.action === 'cancel') return false
      if (confirmation.action === 'discard') return true

      this.applySaveResult({ canceled: false, filePath: confirmation.filePath }, content)
      if (!useAppStore.getState().document.dirty) return true
    }
  }

  private async newDocument(): Promise<void> {
    if (!(await this.confirmDocumentReplacement())) return

    const result = await this.withEditorLocked(() => this.documentsApi.newDocument())
    this.replaceDocument(result.content)
  }

  private async openDocument(filePath?: string): Promise<void> {
    if (!(await this.confirmDocumentReplacement())) return

    const result = await this.withEditorLocked(() =>
      this.documentsApi.openDocument(filePath ? { filePath } : {}),
    )
    if (
      result.canceled ||
      result.error ||
      result.filePath === undefined ||
      result.content === undefined
    ) {
      return
    }

    this.replaceDocument(result.content, result.filePath)
  }

  private async reload(): Promise<void> {
    if (!(await this.confirmDocumentReplacement())) return

    const editor = this.getEditor()
    editor?.setReadOnly(true)
    try {
      await this.documentsApi.reload()
    } catch (error) {
      editor?.setReadOnly(false)
      throw error
    }
  }

  private async close(intent: 'window' | 'application', requestId: string): Promise<void> {
    let proceed = false
    try {
      proceed = await this.confirmDocumentReplacement()
    } finally {
      await this.documentsApi.resolveClose({ intent, requestId, proceed })
    }
  }
}
