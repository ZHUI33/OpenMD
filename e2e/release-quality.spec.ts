import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'

const execFileAsync = promisify(execFile)
const electronExecutable = resolve(
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron',
)
const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function waitForRecoveryContent(recoveryDirectory: string, marker: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const sessionFiles = (await readdir(recoveryDirectory)).filter(
        (entry) => entry === 'session.json' || entry.startsWith('session-'),
      )
      for (const sessionFile of sessionFiles) {
        const session = JSON.parse(
          await readFile(join(recoveryDirectory, sessionFile), 'utf8'),
        ) as {
          tabs?: Array<{ recordFile?: string }>
        }
        const recordsDirectory = join(recoveryDirectory, 'records')
        for (const tab of session.tabs ?? []) {
          if (!tab.recordFile) continue
          if ((await readFile(join(recordsDirectory, tab.recordFile), 'utf8')).includes(marker))
            return
        }
      }
    } catch {
      // The atomic session or record may not have been published yet.
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 100))
  }
  throw new Error('Timed out waiting for the local recovery backup.')
}

async function stop(application: ElectronApplication): Promise<void> {
  const childProcess = application.process()
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(childProcess.pid), '/T', '/F']).catch(
      () => undefined,
    )
  } else if (!childProcess.killed) {
    childProcess.kill('SIGKILL')
  }
  if (childProcess.exitCode === null) {
    await new Promise<void>((resolveExit) => childProcess.once('exit', () => resolveExit()))
  }
}

async function runMenuCommand(application: ElectronApplication, commandId: string): Promise<void> {
  await application.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (!item?.click) throw new Error(`Menu command ${id} was not found.`)
    item.click()
  }, commandId)
}

async function waitForFile(filePath: string): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await stat(filePath)).size
        } catch {
          return 0
        }
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
}

test('release themes, zoom levels, contrast, keyboard focus, and reduced motion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openmd-release-visual-'))
  const userData = join(root, 'user-data')
  await mkdir(userData, { recursive: true })
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({ theme: 'light', autoUpdate: false, sidebarVisible: true }),
    'utf8',
  )
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: [resolve('.')],
    env: {
      ...process.env,
      OPENMD_E2E: '1',
      OPENMD_E2E_USER_DATA: userData,
      OPENMD_E2E_CLOSE_RESPONSE: 'discard',
      OPENMD_DISABLE_UPDATE_CHECKS: '1',
    },
  })

  try {
    const page = await application.firstWindow()
    await expect(page.getByLabel('Markdown 正文编辑器')).toBeVisible()
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25)
    })
    await expect(page).toHaveScreenshot('release-light-125.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    })

    const editor = page.locator('.ProseMirror')
    await editor.focus()
    await page.keyboard.press(`${shortcutModifier}+,`)
    const settingsDialog = page.getByRole('dialog', { name: '设置' })
    await expect(settingsDialog).toBeVisible()
    await page.getByRole('combobox', { name: '主题' }).selectOption('dark')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(settingsDialog).toBeHidden()
    await expect(editor).toBeFocused()

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.5)
    })
    await expect(page).toHaveScreenshot('release-dark-150.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    })

    await page.emulateMedia({
      colorScheme: 'dark',
      forcedColors: 'active',
      reducedMotion: 'reduce',
    })
    await expect(page).toHaveScreenshot('release-high-contrast-150.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    })
  } finally {
    await stop(application)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('an abnormal exit exposes local draft recovery without overwriting a file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openmd-recovery-e2e-'))
  const userData = join(root, 'user-data')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false }), 'utf8')
  const environment = {
    ...process.env,
    OPENMD_E2E: '1',
    OPENMD_E2E_USER_DATA: userData,
    OPENMD_E2E_CLOSE_RESPONSE: 'discard',
    OPENMD_DISABLE_UPDATE_CHECKS: '1',
  }
  let application = await electron.launch({
    executablePath: electronExecutable,
    args: [resolve('.')],
    env: environment,
  })

  try {
    let page = await application.firstWindow()
    await expect(page.getByLabel('Markdown 正文编辑器')).toBeVisible()
    await page.keyboard.press(`${shortcutModifier}+N`)
    const editor = page.locator('.ProseMirror')
    await editor.click()
    const marker = '仅保存在本机的崩溃恢复草稿'
    await page.keyboard.insertText(marker)
    await waitForRecoveryContent(join(userData, 'recovery'), marker)

    await stop(application)
    application = await electron.launch({
      executablePath: electronExecutable,
      args: [resolve('.')],
      env: environment,
    })
    page = await application.firstWindow()
    const recoveryDialog = page.getByRole('dialog', { name: '发现上次未正常结束的工作' })
    await expect(recoveryDialog).toBeVisible()
    await expect(recoveryDialog).toContainText(marker)
    await expect(recoveryDialog).toContainText('原路径：未命名文档')
    await recoveryDialog.getByRole('button', { name: '恢复工作区与全部标签' }).click()
    await expect(recoveryDialog).toBeHidden()
    await expect(page.locator('.ProseMirror')).toContainText(marker)
    await expect(page.getByRole('tab', { name: /已恢复/u }).last()).toHaveAttribute(
      'aria-selected',
      'true',
    )
  } finally {
    await stop(application)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('HTML, PDF, long PNG, and repeat export produce delivery artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openmd-release-export-'))
  const userData = join(root, 'user-data')
  const exportDirectory = join(root, 'exports')
  const documentPath = join(root, 'delivery.md')
  const markdown = [
    '# Delivery export',
    '',
    ...Array.from(
      { length: 100 },
      (_, index) =>
        `## Section ${index + 1}\n\nParagraph ${index + 1} verifies a full-height export.`,
    ),
  ].join('\n\n')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false }), 'utf8')
  await writeFile(documentPath, markdown, 'utf8')
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: [resolve('.'), documentPath],
    env: {
      ...process.env,
      OPENMD_E2E: '1',
      OPENMD_E2E_USER_DATA: userData,
      OPENMD_E2E_EXPORT_DIR: exportDirectory,
      OPENMD_E2E_CLOSE_RESPONSE: 'discard',
      OPENMD_DISABLE_UPDATE_CHECKS: '1',
    },
  })

  try {
    const page = await application.firstWindow()
    await expect(page.locator('.ProseMirror h1')).toContainText('Delivery export')

    await runMenuCommand(application, 'openmd-export-html')
    const htmlDialog = page.getByRole('dialog', { name: 'HTML 文档' })
    await htmlDialog.getByLabel('无样式语义 HTML').check()
    await htmlDialog.getByRole('button', { name: '选择保存位置' }).click()
    const htmlPath = join(exportDirectory, 'openmd-export.html')
    await waitForFile(htmlPath)
    const html = await readFile(htmlPath, 'utf8')
    expect(html).toContain('Content-Security-Policy')
    expect(html).not.toContain('<style>')
    expect(html).not.toMatch(/<script|javascript:|\son[a-z]+=/iu)

    await runMenuCommand(application, 'openmd-export-pdf')
    const pdfDialog = page.getByRole('dialog', { name: 'PDF 文档' })
    await pdfDialog.getByLabel('PDF 主题').selectOption('dark')
    await pdfDialog.getByLabel('页眉').fill('OpenMD delivery')
    await pdfDialog.getByLabel('页脚').fill('Confidential')
    await pdfDialog.getByLabel('显示页码').check()
    await pdfDialog.getByLabel('一级/二级标题前分页').check()
    await pdfDialog.getByRole('button', { name: '选择保存位置' }).click()
    const pdfPath = join(exportDirectory, 'openmd-export.pdf')
    await waitForFile(pdfPath)
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-')

    await runMenuCommand(application, 'openmd-export-png')
    const pngDialog = page.getByRole('dialog', { name: '长图 PNG' })
    await pngDialog.getByLabel('图片宽度（px）').fill('800')
    await pngDialog.getByLabel('PNG 主题').selectOption('dark')
    await pngDialog.getByRole('button', { name: '选择保存位置' }).click()
    const pngPath = join(exportDirectory, 'openmd-export.png')
    await waitForFile(pngPath)
    const pngSize = await application.evaluate(({ nativeImage }, filePath) => {
      return nativeImage.createFromPath(filePath).getSize()
    }, pngPath)
    expect(pngSize.width).toBe(800)
    expect(pngSize.height).toBeGreaterThan(900)

    await rm(pngPath)
    await runMenuCommand(application, 'openmd-export-repeat')
    await waitForFile(pngPath)
    await expect(page.getByRole('dialog', { name: '长图 PNG' })).toBeHidden()
  } finally {
    await stop(application)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
