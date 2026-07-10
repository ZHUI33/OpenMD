import { create } from 'zustand'

export type Theme = 'light' | 'dark' | 'system'

export interface AppState {
  theme: Theme
  sidebarVisible: boolean
}

interface AppActions {
  setTheme: (theme: Theme) => void
  setSidebarVisible: (visible: boolean) => void
  toggleSidebar: () => void
}

type AppStore = AppState & AppActions

const initialState: AppState = {
  theme: 'system',
  sidebarVisible: false,
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
}))
