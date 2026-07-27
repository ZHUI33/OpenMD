const { execFile } = require('node:child_process')
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { promisify } = require('node:util')

const { _electron: electron } = require('@playwright/test')
const execFileAsync = promisify(execFile)

const electronExecutable = resolve(
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron',
)

const guideMarkdown = `# 用 OpenMD 专注写作

OpenMD 是一款本地优先、开源、跨平台的 Markdown 桌面编辑器。

> 默认就是所见即所得：专注内容，需要时再切换 Markdown 源码。

## 今天要做的事

- [x] 整理项目说明
- [x] 插入表格与代码
- [ ] 导出 HTML 和 PDF

| 功能 | 状态 | 快捷键 |
| --- | :---: | --- |
| 所见即所得 | 可用 | Ctrl/Cmd + / |
| 自动保存 | 可用 | 设置中开启 |
| HTML / PDF | 可用 | 文件菜单 |

公式也能直接显示：$E = mc^2$

\`\`\`mermaid
graph LR
  A[写 Markdown] --> B[专注编辑]
  B --> C[导出分享]
\`\`\`
`

async function stopApplication(application) {
  const childProcess = application.process()
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(childProcess.pid), '/T', '/F']).catch(
      () => undefined,
    )
  } else if (!childProcess.killed) {
    childProcess.kill('SIGKILL')
  }
  if (childProcess.exitCode === null) {
    await new Promise((resolveExit) => childProcess.once('exit', resolveExit))
  }
}

async function selectText(page, text) {
  await page.locator('.ProseMirror').evaluate((editor, selectedText) => {
    editor.focus()
    const walker = globalThis.document.createTreeWalker(editor, globalThis.NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      const start = node.textContent?.indexOf(selectedText) ?? -1
      if (start < 0) continue
      const range = globalThis.document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + selectedText.length)
      const selection = globalThis.document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      globalThis.document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
      return
    }
    throw new Error(`Text not found: ${selectedText}`)
  }, text)
}

async function assertNoHorizontalOverflow(page, label) {
  const layout = await page.evaluate(() => ({
    clientWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }))
  if (layout.scrollWidth > layout.clientWidth) {
    throw new Error(
      `${label} produced horizontal overflow: ${layout.scrollWidth}px > ${layout.clientWidth}px`,
    )
  }
  console.log(
    `${label}: no horizontal overflow (${layout.scrollWidth}px / ${layout.clientWidth}px)`,
  )
}

async function setTheme(page, theme) {
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: /设置/u }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.getByLabel('主题').selectOption(theme)
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.locator(`html[data-theme="${theme}"]`).waitFor()
}

async function captureReadme() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'openmd-readme-'))
  const workspacePath = join(temporaryRoot, 'OpenMD-Demo')
  const documentPath = join(workspacePath, 'OpenMD-使用示例.md')
  const outputDirectory = resolve('docs/images')
  const exportDirectory = join(temporaryRoot, 'exports')
  let application

  try {
    await mkdir(outputDirectory, { recursive: true })
    await mkdir(exportDirectory, { recursive: true })
    await mkdir(join(workspacePath, '笔记'), { recursive: true })
    await writeFile(documentPath, guideMarkdown, 'utf8')
    await writeFile(join(workspacePath, 'README.md'), '# OpenMD Demo\n', 'utf8')
    await writeFile(join(workspacePath, '笔记', '发布清单.md'), '- [ ] 发布新版本\n', 'utf8')

    application = await electron.launch({
      executablePath: electronExecutable,
      args: [resolve('.'), documentPath],
      env: {
        ...process.env,
        OPENMD_E2E: '1',
        OPENMD_E2E_USER_DATA: join(temporaryRoot, 'user-data'),
        OPENMD_E2E_EXPORT_DIR: exportDirectory,
        OPENMD_E2E_CLOSE_RESPONSE: 'discard',
        OPENMD_DISABLE_UPDATE_CHECKS: '1',
      },
    })

    const page = await application.firstWindow()
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 960)
    })
    await page.locator('.ProseMirror h1').waitFor()
    await page.locator('.katex').waitFor()

    await application.evaluate(({ dialog }, selectedWorkspacePath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedWorkspacePath] }),
      })
    }, workspacePath)
    await page.getByRole('button', { name: /打开文件夹/u }).click()
    await page.getByRole('button', { name: 'OpenMD-使用示例.md', exact: true }).click()
    await page.getByRole('tab', { name: '大纲' }).click()
    await selectText(page, '本地优先')
    await page.getByRole('toolbar', { name: '文本格式' }).waitFor()
    await page.screenshot({
      path: join(outputDirectory, 'openmd-editor.png'),
      animations: 'disabled',
    })
    await page.screenshot({
      path: join(outputDirectory, 'typora-parity-light.png'),
      animations: 'disabled',
    })

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: /导出 HTML/u }).click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({
      path: join(outputDirectory, 'openmd-export.png'),
      animations: 'disabled',
    })
    await page.keyboard.press('Escape')

    await setTheme(page, 'dark')
    await page.getByRole('tab', { name: '大纲' }).click()
    await page.screenshot({
      path: join(outputDirectory, 'typora-parity-dark.png'),
      animations: 'disabled',
    })

    await setTheme(page, 'light')
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(800, 760)
    })
    await page.getByRole('tab', { name: '文件' }).click()
    await assertNoHorizontalOverflow(page, 'narrow window')
    await page.screenshot({
      path: join(outputDirectory, 'typora-parity-narrow.png'),
      animations: 'disabled',
    })

    for (const zoomFactor of [1, 1.25, 1.5]) {
      await application.evaluate(({ BrowserWindow }, factor) => {
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(factor)
      }, zoomFactor)
      await assertNoHorizontalOverflow(page, `${Math.round(zoomFactor * 100)}% scale`)
    }
  } finally {
    if (application) await stopApplication(application)
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
}

captureReadme().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
