import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

export interface AppState {
  theme: Theme
  sidebarVisible: boolean
  document: DocumentState
}

export interface DocumentState {
  markdown: string
  dirty: boolean
  wordCount: number
  characterCount: number
}

interface AppActions {
  setTheme: (theme: Theme) => void
  setSidebarVisible: (visible: boolean) => void
  toggleSidebar: () => void
  updateMarkdown: (markdown: string) => void
  setDocument: (markdown: string) => void
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

function createDocumentState(markdown: string, dirty: boolean): DocumentState {
  return {
    markdown,
    dirty,
    wordCount: countWords(markdown),
    characterCount: countCharacters(markdown),
  }
}

const initialState: AppState = {
  theme: 'system',
  sidebarVisible: false,
  document: createDocumentState(WELCOME_MARKDOWN, false),
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
  updateMarkdown: (markdown) => {
    set((state) =>
      state.document.markdown === markdown
        ? state
        : { document: createDocumentState(markdown, true) },
    )
  },
  setDocument: (markdown) => {
    set({ document: createDocumentState(markdown, false) })
  },
}))
