import type { WorkspaceEntry } from '../../../shared/desktop-api.types'

export type EntryDialogMode = 'create-file' | 'create-directory' | 'rename'

export function validateWorkspaceEntryName(
  value: string,
  mode: EntryDialogMode,
  entry?: WorkspaceEntry,
): string | undefined {
  const name = value.trim()
  if (!name) return '请输入名称。'
  if (name === '.' || name === '..') return '名称不能是 “.” 或 “..”。'
  if (name.length > 255) return '名称不能超过 255 个字符。'
  const hasControlCharacter = Array.from(name).some(
    (character) => (character.codePointAt(0) ?? 0) <= 0x1f,
  )
  if (hasControlCharacter || /[/\\<>:"|?*]/u.test(name)) {
    return '名称包含文件系统不允许的字符。'
  }
  if (/[. ]$/u.test(name)) return '名称不能以句点或空格结尾。'

  const requiresMarkdown =
    mode === 'create-file' || (mode === 'rename' && entry && entry.kind !== 'directory')
  if (requiresMarkdown) {
    const finalName = /\.[^.]+$/u.test(name) ? name : `${name}.md`
    if (!/\.(?:md|markdown)$/iu.test(finalName)) {
      return 'Markdown 文件必须使用 .md 或 .markdown 扩展名。'
    }
  }
  return undefined
}

export function friendlyWorkspaceError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : ''
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'EEXIST' || /exist|已存在/iu.test(message)) return '同一位置已有同名项目。'
  if (code === 'EACCES' || code === 'EPERM' || /permission|权限|占用/iu.test(message)) {
    return '系统拒绝了此操作，请检查文件权限或是否被其他程序占用。'
  }
  if (code === 'ENOENT' || /not found|不存在/iu.test(message))
    return '目标已经不存在，请刷新文件树。'
  return message.trim() || fallback
}
