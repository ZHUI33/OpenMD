import { create } from 'zustand'

import type { SaveDocumentResult } from '../../../shared/desktop-api.types'
import type { EditorMode, SourceCursorPosition } from '../editor/editor.types'

export type Theme = 'light' | 'dark' | 'system'

export interface AppState {
  theme: Theme
  sidebarVisible: boolean
  editorMode: EditorMode
  sourceLineNumbers: boolean
  sourceLineWrapping: boolean
  sourceCursor: SourceCursorPosition
  document: DocumentState
}

export interface DocumentState {
  markdown: string
  savedMarkdown: string
  filePath?: string
  dirty: boolean
  wordCount: number
  characterCount: number
}

interface AppActions {
  setTheme: (theme: Theme) => void
  setSidebarVisible: (visible: boolean) => void
  toggleSidebar: () => void
  setEditorMode: (mode: EditorMode) => void
  setSourceLineNumbers: (visible: boolean) => void
  setSourceLineWrapping: (enabled: boolean) => void
  setSourceCursor: (position: SourceCursorPosition) => void
  updateMarkdown: (markdown: string) => void
  setDocument: (markdown: string, filePath?: string) => void
  applySaveResult: (result: SaveDocumentResult, savedMarkdown: string) => void
}

type AppStore = AppState & AppActions

export const WELCOME_MARKDOWN = `# 欢迎使用 OpenMD

OpenMD 是一个开源、跨平台的 Markdown 编辑器。

## 开始写作

你可以直接在正文中输入内容。

- 所见即所得
- Markdown 原生存储
- Windows 与 macOS 跨平台`

export function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|```/g, ''))
    .replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2')
    .replace(/<[^>]+>|[#>*_~`|\-[\]]/g, ' ')
  const chineseCharacters =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const otherWords =
    text
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
      ?.filter((word) => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word))
      .length ?? 0
  return chineseCharacters + otherWords
}

export function countCharacters(markdown: string): number {
  return Array.from(markdown).length
}

interface CreateDocumentStateOptions {
  savedMarkdown?: string
  filePath?: string
  forceDirty?: boolean
}

function createDocumentState(
  markdown: string,
  { savedMarkdown = markdown, filePath, forceDirty = false }: CreateDocumentStateOptions = {},
): DocumentState {
  return {
    markdown,
    savedMarkdown,
    filePath,
    dirty: forceDirty || markdown !== savedMarkdown,
    wordCount: countWords(markdown),
    characterCount: countCharacters(markdown),
  }
}

const initialState: AppState = {
  theme: 'system',
  sidebarVisible: false,
  editorMode: 'visual',
  sourceLineNumbers: true,
  sourceLineWrapping: true,
  sourceCursor: { line: 1, column: 1 },
  document: createDocumentState(WELCOME_MARKDOWN),
}

export const useAppStore = create<AppStore>((set) => ({
  ...initialState,
  setTheme: (theme) => {
    set({ theme })
  },
  setSidebarVisible: (sidebarVisible) => {
    set({ sidebarVisible })
  },
  toggleSidebar: () => {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }))
  },
  setEditorMode: (editorMode) => {
    set({ editorMode })
  },
  setSourceLineNumbers: (sourceLineNumbers) => {
    set({ sourceLineNumbers })
  },
  setSourceLineWrapping: (sourceLineWrapping) => {
    set({ sourceLineWrapping })
  },
  setSourceCursor: (sourceCursor) => {
    set({ sourceCursor })
  },
  updateMarkdown: (markdown) => {
    set((state) =>
      state.document.markdown === markdown
        ? state
        : {
            document: createDocumentState(markdown, {
              savedMarkdown: state.document.savedMarkdown,
              filePath: state.document.filePath,
            }),
          },
    )
  },
  setDocument: (markdown, filePath) => {
    set({ document: createDocumentState(markdown, { filePath }) })
  },
  applySaveResult: (result, savedMarkdown) => {
    set((state) => {
      if (result.canceled) return state
      if (result.error || !result.filePath) {
        return {
          document: createDocumentState(state.document.markdown, {
            savedMarkdown: state.document.savedMarkdown,
            filePath: state.document.filePath,
            forceDirty: true,
          }),
        }
      }

      return {
        document: createDocumentState(state.document.markdown, {
          savedMarkdown,
          filePath: result.filePath,
        }),
      }
    })
  },
}))
