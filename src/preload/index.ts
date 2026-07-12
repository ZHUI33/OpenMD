import { contextBridge } from 'electron'

import { openMdApi } from './desktop-api'

contextBridge.exposeInMainWorld('openmd', openMdApi)
