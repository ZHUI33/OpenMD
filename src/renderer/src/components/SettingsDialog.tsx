import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, JSX } from 'react'

import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '../../../shared/settings'
import type { AppSettings, AppSettingsUpdate } from '../../../shared/settings'
import type { UserThemeInfo } from '../../../shared/theme'
import { getRendererSettingsApi } from '../settings/settings-api'
import type { RendererSettingsApi } from '../settings/settings-api'
import { getApplicationThemeController } from '../settings/theme-controller'
import type { ThemeController } from '../settings/theme-controller'
import './SettingsDialog.css'

export interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  onApplied?: (settings: AppSettings) => void | Promise<void>
  settingsApi?: RendererSettingsApi
  /** Pass null when the host applies themes through its own state layer. */
  themeController?: Pick<ThemeController, 'apply'> | null
}

function asSettingsUpdate(settings: AppSettings): AppSettingsUpdate {
  return {
    theme: settings.theme,
    defaultEditorMode: settings.defaultEditorMode,
    autoSave: settings.autoSave,
    autoSaveDelayMs: settings.autoSaveDelayMs,
    autoUpdate: settings.autoUpdate,
    editorFontFamily: settings.editorFontFamily,
    editorFontSizePx: settings.editorFontSizePx,
    editorLineHeight: settings.editorLineHeight,
    editorMaxWidthPx: settings.editorMaxWidthPx,
    sourceLineNumbers: settings.sourceLineNumbers,
    sourceLineWrapping: settings.sourceLineWrapping,
    imageAssetDirectoryRule: settings.imageAssetDirectoryRule,
    customImageAssetDirectory: settings.customImageAssetDirectory,
    showTextFiles: settings.showTextFiles,
  }
}

export function SettingsDialog({
  open,
  onClose,
  onApplied,
  settingsApi,
  themeController,
}: SettingsDialogProps): JSX.Element | null {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState<AppSettings>()
  const [userThemes, setUserThemes] = useState<UserThemeInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    let active = true
    const api = settingsApi ?? getRendererSettingsApi()
    setLoading(true)
    setError(undefined)

    void Promise.all([api.get(), api.listUserThemes().catch(() => [])])
      .then(([settings, themes]) => {
        if (!active) return
        setDraft(settings)
        setUserThemes(themes)
        window.requestAnimationFrame(() => closeButtonRef.current?.focus())
      })
      .catch(() => {
        if (active) setError('无法读取设置，请稍后重试。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, settingsApi])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open, saving])

  if (!open) return null

  const updateDraft = <Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]): void => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!draft || saving) return

    const api = settingsApi ?? getRendererSettingsApi()
    setSaving(true)
    setError(undefined)
    void api
      .update(asSettingsUpdate(draft))
      .then(async (savedSettings) => {
        const controller =
          themeController === undefined ? getApplicationThemeController(api) : themeController
        await controller?.apply(savedSettings)
        await onApplied?.(savedSettings)
        onClose()
      })
      .catch(async () => {
        setError('保存设置失败。请检查自定义主题或输入值后重试。')
        try {
          const recoveredSettings = await api.update({ theme: 'system' })
          const controller =
            themeController === undefined ? getApplicationThemeController(api) : themeController
          await controller?.apply(recoveredSettings)
          await onApplied?.(recoveredSettings)
          setDraft(recoveredSettings)
        } catch {
          // Keep the dialog open so the user can retry after an I/O failure.
        }
      })
      .finally(() => setSaving(false))
  }

  const selectedUserThemeMissing =
    draft?.theme.startsWith('user:') && !userThemes.some((theme) => theme.id === draft.theme)

  return (
    <div
      className="settings-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="settings-dialog__header">
          <div>
            <h2 id={titleId}>设置</h2>
            <p>外观、编辑体验与文件资源偏好</p>
          </div>
          <button
            ref={closeButtonRef}
            className="settings-dialog__close"
            type="button"
            aria-label="关闭设置"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {loading && !draft ? (
          <div className="settings-dialog__state" role="status">
            正在读取设置…
          </div>
        ) : (
          <form className="settings-form" onSubmit={handleSubmit}>
            {draft && (
              <div className="settings-form__scroll">
                <fieldset>
                  <legend>外观</legend>
                  <label className="settings-field">
                    <span>主题</span>
                    <select
                      value={draft.theme}
                      onChange={(event) =>
                        updateDraft('theme', event.currentTarget.value as AppSettings['theme'])
                      }
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">OpenMD Light</option>
                      <option value="dark">OpenMD Dark</option>
                      {userThemes.map((theme) => (
                        <option key={theme.id} value={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                      {selectedUserThemeMissing && (
                        <option value={draft.theme}>
                          {draft.theme.slice('user:'.length)}（不可用）
                        </option>
                      )}
                    </select>
                  </label>
                  <label className="settings-field">
                    <span>字体</span>
                    <input
                      type="text"
                      maxLength={160}
                      value={draft.editorFontFamily}
                      onChange={(event) =>
                        updateDraft('editorFontFamily', event.currentTarget.value)
                      }
                    />
                  </label>
                  <div className="settings-form__grid">
                    <label className="settings-field">
                      <span>字号</span>
                      <input
                        type="number"
                        min={SETTINGS_LIMITS.editorFontSizePx.min}
                        max={SETTINGS_LIMITS.editorFontSizePx.max}
                        step="1"
                        value={draft.editorFontSizePx}
                        onChange={(event) =>
                          updateDraft('editorFontSizePx', event.currentTarget.valueAsNumber)
                        }
                      />
                    </label>
                    <label className="settings-field">
                      <span>行高</span>
                      <input
                        type="number"
                        min={SETTINGS_LIMITS.editorLineHeight.min}
                        max={SETTINGS_LIMITS.editorLineHeight.max}
                        step="0.1"
                        value={draft.editorLineHeight}
                        onChange={(event) =>
                          updateDraft('editorLineHeight', event.currentTarget.valueAsNumber)
                        }
                      />
                    </label>
                    <label className="settings-field">
                      <span>编辑区最大宽度</span>
                      <div className="settings-field__unit">
                        <input
                          type="number"
                          min={SETTINGS_LIMITS.editorMaxWidthPx.min}
                          max={SETTINGS_LIMITS.editorMaxWidthPx.max}
                          step="20"
                          value={draft.editorMaxWidthPx}
                          onChange={(event) =>
                            updateDraft('editorMaxWidthPx', event.currentTarget.valueAsNumber)
                          }
                        />
                        <span>px</span>
                      </div>
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <legend>编辑器</legend>
                  <label className="settings-field">
                    <span>默认编辑模式</span>
                    <select
                      value={draft.defaultEditorMode}
                      onChange={(event) =>
                        updateDraft(
                          'defaultEditorMode',
                          event.currentTarget.value === 'source' ? 'source' : 'visual',
                        )
                      }
                    >
                      <option value="visual">所见即所得</option>
                      <option value="source">源码</option>
                    </select>
                  </label>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={draft.autoSave}
                      onChange={(event) => updateDraft('autoSave', event.currentTarget.checked)}
                    />
                    <span>自动保存</span>
                  </label>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={draft.autoUpdate}
                      onChange={(event) => updateDraft('autoUpdate', event.currentTarget.checked)}
                    />
                    <span>启动时自动检查更新（仅发布版）</span>
                  </label>
                  <label className="settings-field">
                    <span>自动保存延迟</span>
                    <div className="settings-field__unit">
                      <input
                        type="number"
                        min={SETTINGS_LIMITS.autoSaveDelayMs.min}
                        max={SETTINGS_LIMITS.autoSaveDelayMs.max}
                        step="100"
                        disabled={!draft.autoSave}
                        value={draft.autoSaveDelayMs}
                        onChange={(event) =>
                          updateDraft('autoSaveDelayMs', event.currentTarget.valueAsNumber)
                        }
                      />
                      <span>ms</span>
                    </div>
                  </label>
                  <div className="settings-toggle-row">
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={draft.sourceLineNumbers}
                        onChange={(event) =>
                          updateDraft('sourceLineNumbers', event.currentTarget.checked)
                        }
                      />
                      <span>源码模式行号</span>
                    </label>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={draft.sourceLineWrapping}
                        onChange={(event) =>
                          updateDraft('sourceLineWrapping', event.currentTarget.checked)
                        }
                      />
                      <span>源码模式自动换行</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset>
                  <legend>文件与资源</legend>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={draft.showTextFiles}
                      onChange={(event) =>
                        updateDraft('showTextFiles', event.currentTarget.checked)
                      }
                    />
                    <span>文件树显示普通文本文件</span>
                  </label>
                  <label className="settings-field">
                    <span>图片资源目录规则</span>
                    <select
                      value={draft.imageAssetDirectoryRule}
                      onChange={(event) =>
                        updateDraft(
                          'imageAssetDirectoryRule',
                          event.currentTarget.value as AppSettings['imageAssetDirectoryRule'],
                        )
                      }
                    >
                      <option value="document-name">文档名.assets</option>
                      <option value="assets">文档目录/assets</option>
                      <option value="workspace-assets">工作区/assets</option>
                      <option value="custom">自定义相对目录</option>
                    </select>
                  </label>
                  {draft.imageAssetDirectoryRule === 'custom' && (
                    <label className="settings-field">
                      <span>自定义相对目录</span>
                      <input
                        type="text"
                        maxLength={160}
                        placeholder="例如 media/images"
                        value={draft.customImageAssetDirectory}
                        onChange={(event) =>
                          updateDraft('customImageAssetDirectory', event.currentTarget.value)
                        }
                      />
                    </label>
                  )}
                </fieldset>
              </div>
            )}

            {error && (
              <p className="settings-dialog__error" role="alert">
                {error}
              </p>
            )}

            <footer className="settings-dialog__footer">
              <button
                className="settings-button settings-button--quiet"
                type="button"
                disabled={!draft || saving}
                onClick={() => setDraft({ ...DEFAULT_SETTINGS })}
              >
                恢复默认值
              </button>
              <span className="settings-dialog__footer-spacer" />
              <button
                className="settings-button settings-button--quiet"
                type="button"
                disabled={saving}
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="settings-button settings-button--primary"
                type="submit"
                disabled={!draft || saving}
              >
                {saving ? '正在保存…' : '保存'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
