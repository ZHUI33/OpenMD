import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'

import { getMainWindow } from './window'

/** Opt-in-at-startup GitHub Releases updater; every download and install requires confirmation. */
export class UpdateService {
  private started = false

  start(enabled: boolean): void {
    if (
      this.started ||
      !enabled ||
      !app.isPackaged ||
      process.env.OPENMD_DISABLE_UPDATE_CHECKS === '1'
    ) {
      return
    }
    this.started = true
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false

    autoUpdater.on('error', (error) => {
      if (!app.isPackaged) console.error('Update check failed:', error)
    })
    autoUpdater.on('update-available', (info) => {
      void this.confirmDownload(info.version)
    })
    autoUpdater.on('update-downloaded', (info) => {
      void this.confirmInstall(info.version)
    })

    void autoUpdater.checkForUpdates().catch(() => undefined)
  }

  private async confirmDownload(version: string): Promise<void> {
    const parentWindow = getMainWindow()
    const options = {
      type: 'info' as const,
      title: 'OpenMD 更新',
      message: `发现 OpenMD ${version}`,
      detail: '是否现在下载更新？下载完成后仍会再次询问是否安装。',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }
    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options)
    if (result.response === 0) await autoUpdater.downloadUpdate().catch(() => undefined)
  }

  private async confirmInstall(version: string): Promise<void> {
    const parentWindow = getMainWindow()
    const options = {
      type: 'info' as const,
      title: 'OpenMD 更新已下载',
      message: `OpenMD ${version} 已准备好安装`,
      detail: '是否现在重启并安装？选择“稍后”不会强制退出应用。',
      buttons: ['重启并安装', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }
    const result = parentWindow
      ? await dialog.showMessageBox(parentWindow, options)
      : await dialog.showMessageBox(options)
    if (result.response === 0) autoUpdater.quitAndInstall(false, true)
  }
}
