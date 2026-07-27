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

async function selectTextRange(page: Page, startText: string, endText: string): Promise<void> {
  await page.locator('.ProseMirror').evaluate(
    (editor, rangeText) => {
      editor.focus()
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let startNode: Node | undefined
      let endNode: Node | undefined
      let startOffset = -1
      let endOffset = -1
      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent ?? ''
        if (!startNode) {
          const offset = text.indexOf(rangeText.startText)
          if (offset >= 0) {
            startNode = node
            startOffset = offset
          }
        }
        const offset = text.indexOf(rangeText.endText)
        if (startNode && offset >= 0) {
          endNode = node
          endOffset = offset + rangeText.endText.length
          break
        }
      }
      if (!startNode || !endNode) {
        throw new Error(`Text range not found: ${rangeText.startText}…${rangeText.endText}`)
      }
      const selection = document.getSelection()
      const range = document.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
    },
    { endText, startText },
  )
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

    await selectTextRange(page, 'Toolbar bold', 'Keyboard bold')
    await page.keyboard.insertText('跨节点临时编辑 👩🏽‍💻')
    await expect(page.locator('.ProseMirror')).toContainText('跨节点临时编辑 👩🏽‍💻')
    await page.keyboard.press(`${shortcutModifier}+Z`)
    await expect(page.locator('.ProseMirror strong', { hasText: 'Toolbar bold' })).toHaveCount(1)
    await expect(page.locator('.ProseMirror strong', { hasText: 'Keyboard bold' })).toHaveCount(1)
    await page.keyboard.press(
      process.platform === 'darwin' ? `${shortcutModifier}+Shift+Z` : `${shortcutModifier}+Y`,
    )
    await expect(page.locator('.ProseMirror')).toContainText('跨节点临时编辑 👩🏽‍💻')
    await page.keyboard.press(`${shortcutModifier}+Z`)
    await expect(page.locator('.ProseMirror strong', { hasText: 'Toolbar bold' })).toHaveCount(1)
    await expect(page.locator('.ProseMirror strong', { hasText: 'Keyboard bold' })).toHaveCount(1)

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
    await page.keyboard.insertText('中文输入 👩🏽‍💻é')
    await page.locator('.ProseMirror').dispatchEvent('compositionend', { data: '中文输入 👩🏽‍💻é' })

    await runMenuCommand(application, 'openmd-document-save')
    await expect
      .poll(async () => readFile(documentPath, 'utf8'))
      .toContain('https://example.com/openmd')
    const savedMarkdown = await readFile(documentPath, 'utf8')
    expect(savedMarkdown).toMatch(/\*\*Toolbar bold\*\*/u)
    expect(savedMarkdown).toMatch(/\*\*Keyboard bold\*\*/u)
    expect(savedMarkdown).toMatch(/[*_]Keyboard italic[*_]/u)
    expect(savedMarkdown.match(/中文输入 👩🏽‍💻é/gu)).toHaveLength(1)
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

test('phase two find, quick open, tab shortcuts, focus and typewriter workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openmd-phase-two-e2e-'))
  const workspacePath = join(root, 'PhaseTwo')
  const documentPath = join(workspacePath, 'navigation.md')
  const secondPath = join(workspacePath, 'second-note.md')
  const paths: LaunchPaths = {
    root,
    savePath: join(root, 'untitled.md'),
    exportDirectory: join(root, 'exports'),
  }
  const longParagraphs = Array.from(
    { length: 70 },
    (_, index) => `Paragraph ${String(index + 1).padStart(2, '0')} keeps scrolling stable.`,
  )
  const initialMarkdown = [
    '# Phase Two Navigation',
    '',
    'Alpha alpha ALPHA [Alpha link](https://example.com/alpha).',
    '',
    'alphabet remains outside whole-word matching.',
    '',
    '## Long document',
    '',
    ...longParagraphs.flatMap((paragraph) => [paragraph, '']),
  ].join('\n')
  await mkdir(workspacePath)
  await writeFile(documentPath, initialMarkdown, 'utf8')
  await writeFile(secondPath, '# Second Note\n\nA short second document.', 'utf8')

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
    await page.getByRole('button', { name: 'navigation.md', exact: true }).click()
    await expect(page.locator('.ProseMirror h1')).toContainText('Phase Two Navigation')

    await page.keyboard.press(`${shortcutModifier}+F`)
    const findInput = page.getByRole('textbox', { name: '查找内容' })
    await findInput.fill('alpha')
    await page.getByRole('button', { name: '全词匹配' }).click()
    await expect(page.locator('.document-find-bar__count')).toHaveText('1/4')
    await page.getByRole('button', { name: '区分大小写' }).click()
    await expect(page.locator('.document-find-bar__count')).toHaveText('1/1')
    await page.getByRole('button', { name: '区分大小写' }).click()
    await page.getByRole('button', { name: '正则表达式' }).click()
    await findInput.fill('alp.a')
    await expect(page.locator('.document-find-bar__count')).toHaveText('1/4')
    await page.getByRole('button', { name: '正则表达式' }).click()
    await findInput.fill('alpha')

    await page.keyboard.press(`${shortcutModifier}+H`)
    const replaceInput = page.getByRole('textbox', { name: '替换为' })
    await replaceInput.fill('Beta')
    await page.getByRole('button', { name: '全部替换' }).click()
    await expect(page.locator('.ProseMirror')).toContainText('Beta Beta Beta Beta link')
    await expect(page.locator('.ProseMirror a', { hasText: 'Beta link' })).toHaveAttribute(
      'href',
      'https://example.com/alpha',
    )
    await page.screenshot({
      path: resolve('docs/images/typora-parity-phase2-find.png'),
      fullPage: true,
    })

    await findInput.press('Escape')
    await page.locator('.ProseMirror').click()
    await page.keyboard.press(`${shortcutModifier}+Z`)
    await expect(page.locator('.ProseMirror')).toContainText('Alpha alpha ALPHA Alpha link')
    await page.keyboard.press(
      process.platform === 'darwin' ? `${shortcutModifier}+Shift+Z` : `${shortcutModifier}+Y`,
    )
    await expect(page.locator('.ProseMirror')).toContainText('Beta Beta Beta Beta link')

    await page.keyboard.press('F9')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-typewriter-mode', 'true')
    const lastVisualParagraph = page.locator('.ProseMirror p').last()
    await lastVisualParagraph.click()
    await page.keyboard.press('End')
    await page.locator('.openmd-editor-scroll').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.keyboard.insertText(' Visual typewriter validation.')
    await expect
      .poll(() => page.locator('.openmd-editor-scroll').evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)

    await page.keyboard.press(`${shortcutModifier}+/`)
    await expect(page.locator('.openmd-source-editor .cm-editor')).toBeVisible()
    await page.keyboard.press(`${shortcutModifier}+F`)
    await page.getByRole('textbox', { name: '查找内容' }).fill('Beta')
    await expect(page.locator('.document-find-bar__count')).toHaveText('1/4')
    await page.getByRole('textbox', { name: '查找内容' }).press('Enter')
    await expect(page.locator('.document-find-bar__count')).toHaveText('2/4')
    await page.getByRole('textbox', { name: '查找内容' }).press('Shift+Enter')
    await expect(page.locator('.document-find-bar__count')).toHaveText('1/4')
    await page.getByRole('textbox', { name: '查找内容' }).press('Escape')

    const sourceContent = page.locator('.openmd-source-editor .cm-content')
    await sourceContent.click()
    await page.keyboard.press(`${shortcutModifier}+End`)
    await page.locator('.openmd-source-editor .cm-scroller').evaluate((element) => {
      element.scrollTop = 0
    })
    await sourceContent.dispatchEvent('compositionstart', { data: '' })
    await page.keyboard.insertText('\n中文输入法验证')
    await sourceContent.dispatchEvent('compositionend', { data: '中文输入法验证' })
    await expect(sourceContent).toContainText('中文输入法验证')
    await expect
      .poll(() =>
        page.locator('.openmd-source-editor .cm-scroller').evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(0)

    await page.keyboard.press(`${shortcutModifier}+P`)
    const quickOpenInput = page.getByRole('combobox')
    await quickOpenInput.fill('second')
    await expect(page.getByRole('option', { name: /second-note\.md/u })).toBeVisible()
    await page.screenshot({
      path: resolve('docs/images/typora-parity-phase2-quick-open.png'),
      fullPage: true,
    })
    await quickOpenInput.press('Enter')
    await expect(page.getByRole('dialog', { name: '快速打开' })).toBeHidden()
    await expect(page.getByRole('tab', { name: /second-note\.md/u })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await page.keyboard.press(`${shortcutModifier}+P`)
    await page.getByRole('combobox').fill('second')
    await expect(page.getByRole('option', { name: /second-note\.md/u })).toBeVisible()
    await page.getByRole('combobox').press('Enter')
    await expect(page.getByRole('dialog', { name: '快速打开' })).toBeHidden()
    await expect(page.getByRole('tab', { name: /second-note\.md/u })).toHaveCount(1)

    await page.keyboard.press(`${shortcutModifier}+W`)
    await expect(page.getByRole('tab', { name: /second-note\.md/u })).toHaveCount(0)
    await page.keyboard.press(`${shortcutModifier}+Shift+T`)
    await expect(page.getByRole('tab', { name: /second-note\.md/u })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await page.getByRole('tab', { name: /navigation\.md/u }).click()
    await expect(page.locator('.openmd-source-editor .cm-editor')).toBeVisible()
    await page.locator('.openmd-source-editor .cm-scroller').evaluate((element) => {
      element.scrollTop = 520
    })
    await page.keyboard.press('Control+Tab')
    await expect(page.getByRole('tab', { name: /second-note\.md/u })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('Control+Shift+Tab')
    await expect(page.getByRole('tab', { name: /navigation\.md/u })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect
      .poll(() =>
        page.locator('.openmd-source-editor .cm-scroller').evaluate((element) => element.scrollTop),
      )
      .toBeGreaterThan(450)

    await page.keyboard.press('F8')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await sourceContent.click()
    const dimmedLine = page.locator('.openmd-source-editor .cm-line:not(.cm-activeLine)').first()
    await expect(dimmedLine).toHaveCSS('opacity', '0.32')
    await expect(page.locator('.openmd-source-editor .cm-activeLine').first()).toHaveCSS(
      'opacity',
      '1',
    )
    await page.keyboard.press(`${shortcutModifier}+F`)
    await expect(dimmedLine).toHaveCSS('opacity', '1')
    await page.getByRole('textbox', { name: '查找内容' }).press('Escape')

    await page.keyboard.press(`${shortcutModifier}+,`)
    const settingsDialog = page.getByRole('dialog', { name: '设置' })
    await expect(settingsDialog).toBeVisible()
    await page.getByRole('combobox', { name: '打字机模式行为' }).selectOption('always')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(() => window.openmd.settings.get().then((value) => value.typewriterBehavior)),
      )
      .toBe('always')

    await runMenuCommand(application, 'openmd-document-save')
    await expect.poll(async () => readFile(documentPath, 'utf8')).toContain('中文输入法验证')
    const savedMarkdown = await readFile(documentPath, 'utf8')
    expect(savedMarkdown.match(/Beta/gu)).toHaveLength(4)
    expect(savedMarkdown).toContain('[Beta link](https://example.com/alpha)')

    await stopOpenMd(application)
    application = await launchOpenMd(paths)
    page = await application.firstWindow()
    await expect(page.locator('.app-shell')).toHaveAttribute('data-focus-mode', 'true')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-typewriter-mode', 'true')
    await expect
      .poll(() =>
        page.evaluate(() => window.openmd.settings.get().then((value) => value.typewriterBehavior)),
      )
      .toBe('always')
  } finally {
    if (application) await stopOpenMd(application)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
