import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

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

interface LaunchPaths {
  root: string
  savePath: string
  exportDirectory: string
}

async function launchOpenMd(
  paths: LaunchPaths,
  documentPath?: string,
): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronExecutable,
    args: [resolve('.'), ...(documentPath ? [documentPath] : [])],
    env: {
      ...process.env,
      OPENMD_E2E: '1',
      OPENMD_E2E_USER_DATA: join(paths.root, 'user-data'),
      OPENMD_E2E_SAVE_PATH: paths.savePath,
      OPENMD_E2E_EXPORT_DIR: paths.exportDirectory,
      OPENMD_E2E_CLOSE_RESPONSE: 'cancel',
      OPENMD_DISABLE_UPDATE_CHECKS: '1',
    },
  })
}

async function replaceSourceMarkdown(page: Page, markdown: string): Promise<void> {
  const source = page.locator('.cm-content')
  await expect(source).toBeVisible()
  await source.click()
  await page.keyboard.press(`${shortcutModifier}+A`)
  await page.keyboard.insertText(markdown)
}

async function runMenuCommand(application: ElectronApplication, commandId: string): Promise<void> {
  await application.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id)
    if (!item?.click) throw new Error(`Menu command ${id} was not found.`)
    item.click()
  }, commandId)
}

test('critical OpenMD document lifecycle stays inside an isolated temporary directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openmd-e2e-'))
  const paths: LaunchPaths = {
    root,
    savePath: join(root, 'document.md'),
    exportDirectory: join(root, 'exports'),
  }
  const pixelPath = join(root, 'pixel.png')
  await writeFile(
    pixelPath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=',
      'base64',
    ),
  )

  let application: ElectronApplication | undefined
  try {
    application = await launchOpenMd(paths)
    let page = await application.firstWindow()
    await expect(page.getByLabel('Markdown 正文编辑器')).toBeVisible()

    await runMenuCommand(application, 'openmd-document-new')
    await runMenuCommand(application, 'openmd-toggle-editor-mode')
    const initialMarkdown = [
      '# E2E Title',
      '',
      '- first',
      '- second',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| OpenMD | 9 |',
      '',
      '$E = mc^2$',
      '',
      '```mermaid',
      'graph TD',
      '  A[Markdown] --> B[Export]',
      '```',
    ].join('\n')
    await replaceSourceMarkdown(page, initialMarkdown)
    await runMenuCommand(application, 'openmd-document-save')
    await expect(page.locator('.brand-name')).not.toContainText('*')
    expect(await readFile(paths.savePath, 'utf8')).toContain('# E2E Title')

    await page.getByRole('button', { name: '设置' }).click()
    const autoSaveToggle = page.getByRole('checkbox', { name: '自动保存' })
    const autoSaveDelay = page.getByLabel('自动保存延迟')
    await expect(autoSaveDelay).toHaveValue('1500')
    await autoSaveToggle.check()
    await autoSaveDelay.fill('250')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await replaceSourceMarkdown(page, `${initialMarkdown}\n\nAuto-saved content`)
    await expect.poll(async () => readFile(paths.savePath, 'utf8')).toContain('Auto-saved content')
    await expect(page.locator('.brand-name')).not.toContainText('*')

    await application.close()
    application = await launchOpenMd(paths, paths.savePath)
    page = await application.firstWindow()
    await expect(page.locator('.ProseMirror h1')).toContainText('E2E Title')
    await expect(page.locator('.ProseMirror table.children')).toContainText('OpenMD')

    await application.evaluate(({ dialog }, selectedImagePath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedImagePath] }),
      })
    }, pixelPath)
    await page.getByRole('button', { name: '插入图片' }).click()
    await expect(page.locator('img.openmd-image')).toBeVisible()

    await runMenuCommand(application, 'openmd-toggle-editor-mode')
    await expect(page.locator('.cm-content')).toContainText('![')
    await runMenuCommand(application, 'openmd-toggle-editor-mode')
    await expect(page.locator('.katex')).toBeVisible()
    await expect(page.locator('.openmd-mermaid-preview svg')).toBeVisible()

    await page.getByRole('button', { name: '导出 HTML' }).click()
    await page.getByLabel('嵌入 Base64（本地图片）').click()
    await page.getByRole('button', { name: '选择保存位置' }).click()
    const exportedHtmlPath = join(paths.exportDirectory, 'openmd-export.html')
    await expect
      .poll(async () => readFile(exportedHtmlPath, 'utf8').catch(() => ''))
      .toContain('<!doctype html>')
    const exportedHtml = await readFile(exportedHtmlPath, 'utf8')
    expect(exportedHtml).toContain('data:image/')
    expect(exportedHtml).toContain('<svg')
    expect(exportedHtml).not.toContain('<script')

    await page.getByRole('button', { name: '导出 PDF' }).click()
    await page.getByRole('button', { name: '选择保存位置' }).click()
    const exportedPdfPath = join(paths.exportDirectory, 'openmd-export.pdf')
    await expect
      .poll(async () =>
        readFile(exportedPdfPath)
          .then((buffer) => buffer.subarray(0, 4).toString('ascii'))
          .catch(() => ''),
      )
      .toBe('%PDF')

    await runMenuCommand(application, 'openmd-toggle-editor-mode')
    await replaceSourceMarkdown(page, `${initialMarkdown}\n\nunsaved change`)
    await expect(page.locator('.brand-name')).toContainText('*')
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await expect(page.locator('.brand-name')).toContainText('*')
    expect(application.windows()).toHaveLength(1)
  } finally {
    if (application) {
      await application
        .evaluate(() => {
          process.env.OPENMD_E2E_CLOSE_RESPONSE = 'discard'
        })
        .catch(() => undefined)
      await application.close().catch(() => undefined)
    }
    await rm(root, { recursive: true, force: true })
  }
})
