import { contextBridge } from 'electron'

import { desktopApi } from './desktop-api'

contextBridge.exposeInMainWorld('desktop', desktopApi)
