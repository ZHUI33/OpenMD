/* global document */

const { execFile } = require('node:child_process')
const { copyFile, mkdir, mkdtemp, open, rm, stat, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { performance } = require('node:perf_hooks')
const { promisify } = require('node:util')

const { _electron: electron } = require('@playwright/test')

const execFileAsync = promisify(execFile)
const argumentsList = process.argv.slice(2)

function argument(name, fallback) {
  const index = argumentsList.indexOf(name)
  return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback
}

const appDirectory = resolve(argument('--app-dir', '.'))
const fixturesDirectory = resolve(argument('--fixtures', 'benchmarks/fixtures'))
const outputPath = resolve(
  argument('--output', join('benchmarks', 'results', `benchmark-${Date.now()}.json`)),
)
const label = argument('--label', 'working-tree')
const executableRoot = resolve('.')
const electronExecutable = resolve(
  executableRoot,
  process.platform === 'win32'
    ? 'node_modules/electron/dist/electron.exe'
    : process.platform === 'darwin'
      ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
      : 'node_modules/electron/dist/electron',
)
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function stop(application) {
  const processHandle = application.process()
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(processHandle.pid), '/T', '/F']).catch(
      () => undefined,
    )
  } else if (!processHandle.killed) {
    processHandle.kill('SIGKILL')
  }
  if (processHandle.exitCode === null) {
    await new Promise((resolveExit) => processHandle.once('exit', resolveExit))
  }
}

async function runMenu(application, id) {
  await application.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item?.click) throw new Error(`Menu item ${menuId} is unavailable`)
    item.click()
  }, id)
}

async function waitForFile(filePath, expected) {
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    const metadata = await stat(filePath)
    const tailLength = Math.min(metadata.size, 16 * 1024)
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(tailLength)
      await handle.read(buffer, 0, tailLength, metadata.size - tailLength)
      if (buffer.toString('utf8').includes(expected)) return
    } finally {
      await handle.close()
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 100))
  }
  throw new Error(`Timed out waiting for ${filePath} to be saved`)
}

async function benchmarkDocument(name, mode, measureModeSwitch = false, measureEditing = true) {
  const root = await mkdtemp(join(tmpdir(), 'openmd-benchmark-'))
  const userData = join(root, 'user-data')
  const exportDirectory = join(root, 'exports')
  const workingPath = join(root, name)
  await mkdir(userData, { recursive: true })
  await mkdir(exportDirectory, { recursive: true })
  await copyFile(join(fixturesDirectory, name), workingPath)
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({ defaultEditorMode: mode, autoUpdate: false }),
    'utf8',
  )

  const startedAt = performance.now()
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: [appDirectory, workingPath],
    cwd: appDirectory,
    env: {
      ...process.env,
      OPENMD_E2E: '1',
      OPENMD_E2E_USER_DATA: userData,
      OPENMD_E2E_EXPORT_DIR: exportDirectory,
      OPENMD_E2E_CLOSE_RESPONSE: 'discard',
      OPENMD_DISABLE_UPDATE_CHECKS: '1',
    },
    timeout: 300_000,
  })

  try {
    const page = await application.firstWindow({ timeout: 300_000 })
    const selector = mode === 'source' ? '.openmd-source-editor .cm-editor' : '.ProseMirror'
    await page.locator(selector).waitFor({ state: 'visible', timeout: 300_000 })
    await page.locator('.openmd-editor-layout').waitFor({ state: 'visible', timeout: 300_000 })
    await page.waitForFunction(
      () =>
        document.querySelector('.openmd-editor-layout')?.getAttribute('data-switching') === 'false',
      undefined,
      { timeout: 300_000 },
    )
    const openMs = performance.now() - startedAt

    if (!measureEditing) return { openMs }

    const editor = page.locator(
      mode === 'source' ? '.openmd-source-editor .cm-content' : '.ProseMirror',
    )
    await editor.click()
    await page.keyboard.press(`${primaryModifier}+End`)
    const inputStartedAt = performance.now()
    const marker = `benchmark-input-${Date.now()}`
    await page.keyboard.insertText(`\n${marker}`)
    await page.waitForFunction(() => document.title.includes(' *'), undefined, {
      timeout: 120_000,
    })
    const inputMs = performance.now() - inputStartedAt

    const saveStartedAt = performance.now()
    await runMenu(application, 'openmd-document-save')
    await waitForFile(workingPath, marker)
    const saveMs = performance.now() - saveStartedAt

    let modeSwitchMs
    if (measureModeSwitch) {
      const switchStartedAt = performance.now()
      await runMenu(application, 'openmd-toggle-editor-mode')
      const switchedSelector =
        mode === 'source' ? '.ProseMirror' : '.openmd-source-editor .cm-editor'
      await page.locator(switchedSelector).waitFor({ state: 'visible', timeout: 300_000 })
      await page.waitForFunction(
        () =>
          document.querySelector('.openmd-editor-layout')?.getAttribute('data-switching') ===
          'false',
        undefined,
        { timeout: 300_000 },
      )
      modeSwitchMs = performance.now() - switchStartedAt
    }

    return { openMs, inputMs, saveMs, modeSwitchMs }
  } finally {
    await stop(application)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

async function benchmarkTabSwitch() {
  const root = await mkdtemp(join(tmpdir(), 'openmd-tab-benchmark-'))
  const userData = join(root, 'user-data')
  const firstPath = join(root, 'first.md')
  const secondPath = join(root, 'second.md')
  await mkdir(userData, { recursive: true })
  await copyFile(join(fixturesDirectory, 'document-1mb.md'), firstPath)
  await copyFile(join(fixturesDirectory, 'long-list.md'), secondPath)
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({ defaultEditorMode: 'source', autoUpdate: false }),
    'utf8',
  )
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: [appDirectory, firstPath],
    cwd: appDirectory,
    env: {
      ...process.env,
      OPENMD_E2E: '1',
      OPENMD_E2E_USER_DATA: userData,
      OPENMD_E2E_CLOSE_RESPONSE: 'discard',
      OPENMD_DISABLE_UPDATE_CHECKS: '1',
    },
    timeout: 300_000,
  })
  try {
    const page = await application.firstWindow({ timeout: 300_000 })
    await page.locator('.cm-editor').waitFor({ state: 'visible', timeout: 300_000 })
    await application.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedPath] }),
      })
    }, secondPath)
    await runMenu(application, 'openmd-open')
    await page.getByRole('tab', { name: /second\.md/u }).waitFor({ timeout: 300_000 })
    const firstTab = page.getByRole('tab', { name: /first\.md/u })
    const switchStartedAt = performance.now()
    await firstTab.click()
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent?.includes('first.md') &&
        document.querySelector('.openmd-editor-layout')?.getAttribute('data-switching') === 'false',
      undefined,
      { timeout: 300_000 },
    )
    return performance.now() - switchStartedAt
  } finally {
    await stop(application)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

async function main() {
  const scenarios = [
    ['document-1mb.md', 'source', true, true],
    ['document-5mb.md', 'source', false, true],
    ['long-list.md', 'source', false, true],
    ['large-table.md', 'visual', false, false],
    ['many-code-blocks.md', 'visual', false, false],
    ['many-mermaid.md', 'visual', false, false],
  ]
  const results = {}
  const createReport = () => ({
    label,
    measuredAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    unit: 'milliseconds',
    results,
  })
  await mkdir(resolve(outputPath, '..'), { recursive: true })
  for (const [name, mode, switchMode, measureEditing] of scenarios) {
    process.stdout.write(`Benchmarking ${name} (${mode})…\n`)
    results[`${name}:${mode}`] = await benchmarkDocument(name, mode, switchMode, measureEditing)
    await writeFile(outputPath, `${JSON.stringify(createReport(), null, 2)}\n`, 'utf8')
  }
  process.stdout.write('Benchmarking tab switch…\n')
  results.tabSwitchMs = await benchmarkTabSwitch()

  const report = createReport()
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
