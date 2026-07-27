import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const electronExecutable = resolve(
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron',
)
const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const clickModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const execFileAsync = promisify(execFile)

interface LaunchPaths {
  root: string
  savePath: string
  exportDirectory: string
}

async function launchOpenMd(paths: LaunchPaths): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronExecutable,
    args: [resolve('.')],
    env: {
      ...process.env,
      OPENMD_E2E: '1',
      OPENMD_E2E_USER_DATA: join(paths.root, 'user-data'),
      OPENMD_E2E_SAVE_PATH: paths.savePath,
      OPENMD_E2E_EXPORT_DIR: paths.exportDirectory,
      OPENMD_E2E_CLOSE_RESPONSE: 'discard',
      OPENMD_DISABLE_UPDATE_CHECKS: '1',
    },
  })
}

async function stopOpenMd(application: ElectronApplication): Promise<void> {
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

async function selectText(page: Page, text: string): Promise<void> {
  await page.locator('.ProseMirror').evaluate((editor, selectedText) => {
    editor.focus()
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const start = node.textContent?.indexOf(selectedText) ?? -1
      if (start < 0) continue
      const selection = document.getSelection()
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + selectedText.length)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      return
    }
    throw new Error(`Text not found: ${selectedText}`)
  }, text)
}

test('focused writing workflow, formatting, and sidebar settings survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openmd-e2e-'))
  const workspacePath = join(root, 'Writing')
  const documentPath = join(workspacePath, 'guide.md')
  const paths: LaunchPaths = {
    root,
    savePath: join(root, 'untitled.md'),
    exportDirectory: join(root, 'exports'),
  }
  const initialMarkdown = [
    '# E2E Writing',
    '',
    'Toolbar bold · Keyboard bold · Keyboard italic · Link target',
    '',
    '## Outline target',
    '',
    'A paragraph for composition.',
  ].join('\n')
  await mkdir(workspacePath)
  await writeFile(documentPath, initialMarkdown, 'utf8')
  await writeFile(join(workspacePath, 'second.md'), '# Second tab', 'utf8')

  let application: ElectronApplication | undefined
  try {
    application = await launchOpenMd(paths)
    let page = await application.firstWindow()
    await expect(page.getByLabel('Markdown 正文编辑器')).toBeVisible()

    await application.evaluate(({ dialog }, selectedWorkspacePath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedWorkspacePath] }),
      })
    }, workspacePath)
    await page.getByRole('button', { name: /打开文件夹/u }).click()
    await expect(page.getByRole('tree')).toBeVisible()
    await page.getByRole('button', { name: 'guide.md', exact: true }).click()
    await expect(page.locator('.ProseMirror h1')).toContainText('E2E Writing')

    const panelTabs = page.getByRole('tablist', { name: '侧栏面板' })
    await panelTabs.getByRole('tab', { name: '大纲' }).click()
    await expect(page.getByRole('navigation', { name: '标题导航' })).toContainText('Outline target')
    await panelTabs.getByRole('tab', { name: '搜索' }).click()
    await expect(page.getByRole('searchbox', { name: '搜索工作区' })).toBeVisible()
    await panelTabs.getByRole('tab', { name: '文件' }).click()
    await expect(page.getByRole('tree')).toBeVisible()

    const resizeHandle = page.getByRole('separator', { name: '调整侧栏宽度' })
    await resizeHandle.press('End')
    await expect
      .poll(() =>
        page.evaluate(() => window.openmd.settings.get().then((value) => value.sidebarWidthPx)),
      )
      .toBe(420)
    await expect(page.locator('.navigation-sidebar')).toHaveCSS('width', '420px')

    await selectText(page, 'Toolbar bold')
    await expect(page.getByRole('toolbar', { name: '文本格式' })).toBeVisible()
    await page.getByRole('button', { name: /粗体/u }).click()

    await selectText(page, 'Keyboard bold')
    await page.keyboard.press(`${shortcutModifier}+B`)
    await selectText(page, 'Keyboard italic')
    await page.keyboard.press(`${shortcutModifier}+I`)

    await selectText(page, 'Link target')
    await page.keyboard.press(`${shortcutModifier}+K`)
    const linkInput = page.getByRole('textbox', { name: '链接地址' })
    await expect(linkInput).toBeVisible()
    await linkInput.fill('https://example.com/openmd')
    await linkInput.press('Enter')
    const renderedLink = page.locator('.ProseMirror a', { hasText: 'Link target' })
    await expect(renderedLink).toHaveAttribute('href', 'https://example.com/openmd')

    const pageUrl = page.url()
    await renderedLink.click()
    await expect(linkInput).toHaveValue('https://example.com/openmd')
    expect(page.url()).toBe(pageUrl)
    await linkInput.press('Escape')

    await expect(
      page.evaluate(() => window.openmd.openExternalUrl({ url: 'javascript:alert(1)' })),
    ).rejects.toThrow(/protocol/u)
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('openmd:app:open-external-url')
      ipcMain.handle('openmd:app:open-external-url', (_event, request: { url: string }) => {
        process.env.OPENMD_E2E_EXTERNAL_URL = request.url
      })
    })
    await renderedLink.dispatchEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: clickModifier === 'Control',
      metaKey: clickModifier === 'Meta',
    })
    await expect
      .poll(() => application!.evaluate(() => process.env.OPENMD_E2E_EXTERNAL_URL))
      .toBe('https://example.com/openmd')

    const compositionParagraph = page.locator('.ProseMirror p', {
      hasText: 'A paragraph for composition.',
    })
    await compositionParagraph.click()
    await page.keyboard.press('End')
    await page.locator('.ProseMirror').dispatchEvent('compositionstart', { data: '' })
    await page.keyboard.insertText('中文输入')
    await page.locator('.ProseMirror').dispatchEvent('compositionend', { data: '中文输入' })

    await runMenuCommand(application, 'openmd-document-save')
    await expect
      .poll(async () => readFile(documentPath, 'utf8'))
      .toContain('https://example.com/openmd')
    const savedMarkdown = await readFile(documentPath, 'utf8')
    expect(savedMarkdown).toMatch(/\*\*Toolbar bold\*\*/u)
    expect(savedMarkdown).toMatch(/\*\*Keyboard bold\*\*/u)
    expect(savedMarkdown).toMatch(/[*_]Keyboard italic[*_]/u)
    expect(savedMarkdown.match(/中文输入/gu)).toHaveLength(1)
    expect(savedMarkdown).not.toMatch(/data-openmd|<span|<strong/iu)

    await page.getByRole('tab', { name: '文件' }).click()
    await page.getByRole('button', { name: 'second.md', exact: true }).click()
    await expect(page.getByRole('tab', { name: /second\.md/u })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('tab', { name: /guide\.md/u }).click()
    await expect(page.locator('.ProseMirror h1')).toContainText('E2E Writing')

    await panelTabs.getByRole('tab', { name: '大纲' }).click()
    await stopOpenMd(application)
    application = await launchOpenMd(paths)
    page = await application.firstWindow()
    await expect(page.getByLabel('导航侧栏')).toBeVisible()
    await expect(page.getByRole('tab', { name: '大纲' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.navigation-sidebar')).toHaveCSS('width', '420px')
  } finally {
    if (application) {
      await stopOpenMd(application)
    }
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
