import type { RendererCommand } from './desktop-api.types'

export type AppCommandType = Exclude<RendererCommand['type'], 'close' | 'open-recent'>

export interface AppCommandDefinition {
  type: AppCommandType
  id: `openmd-${string}`
  label: string
  accelerator?: string
  key: string
  primary?: boolean
  ctrl?: boolean
  shift?: boolean
}

function command(
  type: AppCommandType,
  label: string,
  key: string,
  options: Omit<AppCommandDefinition, 'type' | 'id' | 'label' | 'key'> = {},
): AppCommandDefinition {
  return { type, id: `openmd-${type}`, label, key, ...options }
}

export const APP_COMMANDS = Object.freeze({
  new: command('new', '新建', 'n', { primary: true, accelerator: 'CmdOrCtrl+N' }),
  open: command('open', '打开…', 'o', { primary: true, accelerator: 'CmdOrCtrl+O' }),
  'open-workspace': command('open-workspace', '打开文件夹工作区…', 'o', {
    primary: true,
    shift: true,
    accelerator: 'CmdOrCtrl+Shift+O',
  }),
  'quick-open': command('quick-open', '快速打开…', 'p', {
    primary: true,
    accelerator: 'CmdOrCtrl+P',
  }),
  save: command('save', '保存', 's', { primary: true, accelerator: 'CmdOrCtrl+S' }),
  'save-as': command('save-as', '另存为…', 's', {
    primary: true,
    shift: true,
    accelerator: 'CmdOrCtrl+Shift+S',
  }),
  'close-tab': command('close-tab', '关闭当前标签', 'w', {
    primary: true,
    accelerator: 'CmdOrCtrl+W',
  }),
  'reopen-closed-tab': command('reopen-closed-tab', '恢复最近关闭的标签', 't', {
    primary: true,
    shift: true,
    accelerator: 'CmdOrCtrl+Shift+T',
  }),
  'next-tab': command('next-tab', '下一个标签', 'Tab', {
    ctrl: true,
    accelerator: 'Ctrl+Tab',
  }),
  'previous-tab': command('previous-tab', '上一个标签', 'Tab', {
    ctrl: true,
    shift: true,
    accelerator: 'Ctrl+Shift+Tab',
  }),
  find: command('find', '查找…', 'f', {
    primary: true,
    accelerator: 'CmdOrCtrl+F',
  }),
  replace: command('replace', '替换…', 'h', {
    primary: true,
    accelerator: 'CmdOrCtrl+H',
  }),
  'search-workspace': command('search-workspace', '在工作区中搜索', 'f', {
    primary: true,
    shift: true,
    accelerator: 'CmdOrCtrl+Shift+F',
  }),
  'open-settings': command('open-settings', '设置…', ',', {
    primary: true,
    accelerator: 'CmdOrCtrl+,',
  }),
  'toggle-editor-mode': command('toggle-editor-mode', '切换编辑模式', '/', {
    primary: true,
    accelerator: 'CmdOrCtrl+/',
  }),
  'toggle-focus-mode': command('toggle-focus-mode', '专注模式', 'F8', {
    accelerator: 'F8',
  }),
  'toggle-typewriter-mode': command('toggle-typewriter-mode', '打字机模式', 'F9', {
    accelerator: 'F9',
  }),
  'toggle-source-line-numbers': command('toggle-source-line-numbers', '切换源码行号', ''),
  'toggle-source-line-wrapping': command('toggle-source-line-wrapping', '切换长行自动换行', ''),
  'export-html': command('export-html', '导出 HTML…', 'h', {
    primary: true,
    accelerator: 'CmdOrCtrl+Alt+H',
  }),
  'export-pdf': command('export-pdf', '导出 PDF…', 'p', {
    primary: true,
    accelerator: 'CmdOrCtrl+Alt+P',
  }),
  reload: command('reload', '重新加载', 'r', {
    primary: true,
    accelerator: 'CmdOrCtrl+R',
  }),
} satisfies Record<AppCommandType, AppCommandDefinition>)

export function eventMatchesCommand(
  event: Readonly<{
    altKey: boolean
    ctrlKey: boolean
    key: string
    metaKey: boolean
    shiftKey: boolean
  }>,
  definition: AppCommandDefinition,
): boolean {
  if (!definition.key) return false
  const keyMatches =
    definition.key.length === 1
      ? event.key.toLocaleLowerCase('en-US') === definition.key.toLocaleLowerCase('en-US')
      : event.key === definition.key
  if (!keyMatches) return false

  const primaryPressed = event.ctrlKey || event.metaKey
  if (definition.primary && !primaryPressed) return false
  if (definition.ctrl && (!event.ctrlKey || event.metaKey)) return false
  if (!definition.primary && !definition.ctrl && primaryPressed) return false
  if (Boolean(definition.shift) !== event.shiftKey) return false
  const acceleratorUsesAlt = definition.accelerator?.includes('Alt+') ?? false
  return acceleratorUsesAlt === event.altKey
}

export function displayAccelerator(
  definition: AppCommandDefinition,
  platform: 'darwin' | 'win32' | 'linux',
): string | undefined {
  const accelerator = definition.accelerator
  if (!accelerator) return undefined
  return accelerator
    .replace('CmdOrCtrl', platform === 'darwin' ? '⌘' : 'Ctrl')
    .replaceAll('Shift', platform === 'darwin' ? '⇧' : 'Shift')
    .replaceAll('Ctrl', platform === 'darwin' ? '⌃' : 'Ctrl')
    .replaceAll('Alt', platform === 'darwin' ? '⌥' : 'Alt')
    .replaceAll('+', platform === 'darwin' ? '' : '+')
}
