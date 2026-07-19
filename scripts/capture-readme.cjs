const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const { _electron: electron } = require('@playwright/test')

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

async function captureReadme() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'openmd-readme-'))
  const workspacePath = join(temporaryRoot, 'OpenMD-Demo')
  const documentPath = join(workspacePath, 'OpenMD-使用示例.md')
  const outputDirectory = resolve('docs/images')
  let application

  try {
    await mkdir(outputDirectory, { recursive: true })
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
    await page.locator('.openmd-mermaid-preview svg').waitFor()

    await application.evaluate(({ dialog }, workspacePath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [workspacePath] }),
      })
    }, workspacePath)
    await page.getByRole('button', { name: '打开文件夹' }).click()
    await page.getByRole('button', { name: 'OpenMD-使用示例.md', exact: true }).waitFor()
    await page.screenshot({
      path: join(outputDirectory, 'openmd-editor.png'),
      animations: 'disabled',
    })

    await page.getByRole('button', { name: '导出 HTML' }).click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({
      path: join(outputDirectory, 'openmd-export.png'),
      animations: 'disabled',
    })
  } finally {
    await application?.close().catch(() => undefined)
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

captureReadme().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
