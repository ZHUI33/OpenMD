const { resolve } = require('node:path')

const electronExecutable = resolve(
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron',
)

async function renderInElectron() {
  const { app, BrowserWindow } = require('electron')

  await app.whenReady()
  const renderer = new BrowserWindow({
    show: true,
    width: 1024,
    height: 1024,
    useContentSize: true,
    frame: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  await renderer.loadFile(resolve('resources/icon.svg'))
}

async function captureFromNode() {
  const { _electron: electron } = require('@playwright/test')
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: [__filename],
  })

  try {
    const page = await application.firstWindow()
    await page.screenshot({
      path: resolve('resources/icon.png'),
      animations: 'disabled',
      omitBackground: true,
    })
    console.log(`Generated ${resolve('resources/icon.png')}`)
  } finally {
    await application.close()
  }
}

const run = process.versions.electron ? renderInElectron : captureFromNode

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
