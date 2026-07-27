import type { Mark, MarkType, ResolvedPos } from '@milkdown/kit/prose/model'
import { toggleMark } from '@milkdown/kit/prose/commands'
import { Plugin, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState, PluginView } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export interface FormattingFeatureOptions {
  openExternalUrl: (url: string) => Promise<void>
  onError?: (message: string) => void
}

export type FormattingCommand = 'strong' | 'emphasis' | 'strike_through' | 'inlineCode'

interface MarkRange {
  from: number
  to: number
  mark: Mark
}

interface ToolbarButtonDefinition {
  command?: FormattingCommand
  label: string
  icon: readonly string[]
  action?: 'link' | 'clear'
}

const buttonDefinitions: readonly ToolbarButtonDefinition[] = [
  {
    command: 'strong',
    label: '粗体 (Ctrl/Cmd+B)',
    icon: ['M7 5h5.5a4 4 0 0 1 0 8H7z', 'M7 13h6a4 4 0 0 1 0 8H7z'],
  },
  {
    command: 'emphasis',
    label: '斜体 (Ctrl/Cmd+I)',
    icon: ['M10 5h8M6 21h8M14 5 10 21'],
  },
  {
    command: 'strike_through',
    label: '删除线',
    icon: [
      'M5 12h14',
      'M8 8c0-2 1.8-3 4.2-3 2 0 3.5.8 4.3 2',
      'M8 16c.8 2 2.4 3 4.5 3 2.2 0 3.8-1 3.8-3',
    ],
  },
  {
    command: 'inlineCode',
    label: '行内代码',
    icon: ['m9 8-4 4 4 4', 'm15 8 4 4-4 4'],
  },
  {
    action: 'link',
    label: '链接 (Ctrl/Cmd+K)',
    icon: [
      'M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1',
      'M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1',
    ],
  },
  {
    action: 'clear',
    label: '清除格式',
    icon: ['m5 19 6-6', 'm8 5 11 11-4 4L4 9z', 'M13 20h7'],
  },
]

export function normalizeEditableLink(value: string): string | undefined {
  const href = value.trim()
  if (!href) return ''
  const hasControlCharacter = Array.from(href).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  if (href.length > 8_192 || hasControlCharacter) return undefined
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/iu)?.[1]?.toLocaleLowerCase('en-US')
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return undefined
  return href
}

export function isExternalLink(href: string): boolean {
  return /^(?:https?|mailto):/iu.test(href)
}

export function toggleFormattingMark(view: EditorView, command: FormattingCommand): boolean {
  const markType = view.state.schema.marks[command]
  if (!markType) return false
  return toggleMark(markType)(view.state, view.dispatch, view)
}

export function clearFormatting(view: EditorView): boolean {
  const { from, to, empty } = view.state.selection
  if (empty) return false
  view.dispatch(view.state.tr.removeMark(from, to).scrollIntoView())
  return true
}

function findMarkRange($position: ResolvedPos, markType: MarkType): MarkRange | undefined {
  const parent = $position.parent
  const offset = $position.parentOffset
  let adjacent = parent.childAfter(offset)
  if (!adjacent.node || !markType.isInSet(adjacent.node.marks)) {
    adjacent = parent.childBefore(offset)
  }
  const mark = adjacent.node ? markType.isInSet(adjacent.node.marks) : undefined
  if (!adjacent.node || !mark) return undefined

  let startIndex = adjacent.index
  let startOffset = adjacent.offset
  while (startIndex > 0 && mark.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1
    startOffset -= parent.child(startIndex).nodeSize
  }

  let endIndex = adjacent.index + 1
  let endOffset = adjacent.offset + adjacent.node.nodeSize
  while (endIndex < parent.childCount && mark.isInSet(parent.child(endIndex).marks)) {
    endOffset += parent.child(endIndex).nodeSize
    endIndex += 1
  }

  return {
    from: $position.start() + startOffset,
    to: $position.start() + endOffset,
    mark,
  }
}

function createSvg(pathData: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '17')
  svg.setAttribute('height', '17')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const data of pathData) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', data)
    svg.append(path)
  }
  return svg
}

function createIconButton(label: string, pathData: readonly string[]): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'openmd-format-button'
  button.setAttribute('aria-label', label)
  button.title = label
  button.append(createSvg(pathData))
  return button
}

class FormattingToolbarView implements PluginView {
  readonly #toolbar = document.createElement('div')
  readonly #buttonByCommand = new Map<FormattingCommand, HTMLButtonElement>()
  readonly #linkButton: HTMLButtonElement
  readonly #linkEditor = document.createElement('form')
  readonly #linkInput = document.createElement('input')
  readonly #linkMessage = document.createElement('span')
  readonly #openLinkButton = createIconButton('在系统浏览器中打开链接', [
    'M14 4h6v6',
    'm20 4-9 9',
    'M18 13v7H4V6h7',
  ])
  readonly #removeLinkButton = createIconButton('移除链接', [
    'M4 7h16',
    'M9 7V4h6v3',
    'M8 7l1 13h6l1-13',
  ])
  readonly #confirmLinkButton = createIconButton('确认链接', ['m5 12 4 4L19 6'])
  readonly #view: EditorView
  readonly #options: FormattingFeatureOptions
  #linkRange: { from: number; to: number; mark?: Mark } | undefined
  #linkEditing = false
  #dismissedSelection: string | undefined
  #lastSelection = ''

  constructor(view: EditorView, options: FormattingFeatureOptions) {
    this.#view = view
    this.#options = options
    this.#toolbar.className = 'openmd-format-toolbar'
    this.#toolbar.setAttribute('role', 'toolbar')
    this.#toolbar.setAttribute('aria-label', '文本格式')
    this.#toolbar.hidden = true

    buttonDefinitions.forEach((definition, index) => {
      if (index === 4 || index === 5) {
        const separator = document.createElement('span')
        separator.className = 'openmd-format-separator'
        separator.setAttribute('role', 'separator')
        this.#toolbar.append(separator)
      }
      const button = createIconButton(definition.label, definition.icon)
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        if (definition.command) {
          toggleFormattingMark(this.#view, definition.command)
          this.#view.focus()
        } else if (definition.action === 'clear') {
          clearFormatting(this.#view)
          this.#view.focus()
        } else {
          this.#showLinkEditor()
        }
      })
      if (definition.command) this.#buttonByCommand.set(definition.command, button)
      this.#toolbar.append(button)
    })
    this.#linkButton =
      this.#toolbar.querySelectorAll<HTMLButtonElement>('.openmd-format-button')[4]!

    this.#linkEditor.className = 'openmd-link-editor'
    this.#linkEditor.hidden = true
    this.#linkInput.type = 'text'
    this.#linkInput.inputMode = 'url'
    this.#linkInput.placeholder = '输入链接或相对路径'
    this.#linkInput.setAttribute('aria-label', '链接地址')
    this.#linkMessage.className = 'openmd-link-message'
    this.#linkMessage.setAttribute('aria-live', 'polite')
    this.#openLinkButton.classList.add('openmd-link-open')
    this.#removeLinkButton.classList.add('openmd-link-remove')
    this.#confirmLinkButton.classList.add('openmd-link-confirm')
    this.#linkEditor.append(
      this.#linkInput,
      this.#linkMessage,
      this.#openLinkButton,
      this.#removeLinkButton,
      this.#confirmLinkButton,
    )
    this.#toolbar.append(this.#linkEditor)
    document.body.append(this.#toolbar)

    this.#linkEditor.addEventListener('submit', (event) => {
      event.preventDefault()
      this.#applyLink()
    })
    this.#linkInput.addEventListener('input', () => this.#updateLinkControls())
    this.#linkInput.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        this.#dismiss()
      }
    })
    this.#openLinkButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      void this.#openExternal(this.#linkInput.value)
    })
    this.#removeLinkButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.#removeLink()
    })
    this.#confirmLinkButton.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      this.#applyLink()
    })
    view.dom.addEventListener('keydown', this.#onEditorKeyDown, true)
    view.dom.addEventListener('click', this.#onEditorClick, true)
    document.addEventListener('pointerdown', this.#onDocumentPointerDown, true)
    this.update(view)
  }

  #selectionKey(state: EditorState): string {
    return `${state.selection.from}:${state.selection.to}:${state.selection.constructor.name}`
  }

  #onEditorKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.#view.composing) return
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && !event.altKey && event.key.toLocaleLowerCase('en-US') === 'k') {
      event.preventDefault()
      event.stopPropagation()
      this.#showLinkEditor()
      return
    }
    if (event.key === 'Escape' && !this.#toolbar.hidden) {
      event.preventDefault()
      event.stopPropagation()
      this.#dismiss()
    }
  }

  #onEditorClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest('a') : null
    if (!(target instanceof HTMLAnchorElement) || !this.#view.dom.contains(target)) return
    event.preventDefault()
    event.stopPropagation()
    const href = target.getAttribute('href') ?? ''
    if (event.ctrlKey || event.metaKey) {
      void this.#openExternal(href)
      return
    }

    const linkType = this.#view.state.schema.marks.link
    if (!linkType) return
    const rawPosition = this.#view.posAtDOM(target, 0)
    const position = Math.max(0, Math.min(this.#view.state.doc.content.size, rawPosition + 1))
    const range = findMarkRange(this.#view.state.doc.resolve(position), linkType)
    if (!range) return
    this.#view.dispatch(
      this.#view.state.tr
        .setSelection(TextSelection.create(this.#view.state.doc, range.from, range.to))
        .scrollIntoView(),
    )
    this.#linkRange = range
    this.#showLinkEditor()
  }

  #onDocumentPointerDown = (event: PointerEvent): void => {
    if (
      event.target instanceof Node &&
      !this.#toolbar.contains(event.target) &&
      !this.#view.dom.contains(event.target)
    ) {
      this.#hide()
    }
  }

  #resolveLinkRange(): { from: number; to: number; mark?: Mark } {
    const { selection, schema, doc } = this.#view.state
    const linkType = schema.marks.link
    if (linkType && selection.empty) {
      const existing = findMarkRange(selection.$from, linkType)
      if (existing) return existing
    }
    if (linkType && !selection.empty) {
      let linkMark: Mark | undefined
      doc.nodesBetween(selection.from, selection.to, (node) => {
        linkMark ??= linkType.isInSet(node.marks)
      })
      return { from: selection.from, to: selection.to, mark: linkMark }
    }
    return { from: selection.from, to: selection.to }
  }

  #showLinkEditor(): void {
    if (!this.#view.editable || this.#view.composing) return
    this.#dismissedSelection = undefined
    this.#linkEditing = true
    this.#linkRange = this.#resolveLinkRange()
    this.#linkInput.value = String(this.#linkRange.mark?.attrs.href ?? '')
    this.#linkEditor.hidden = false
    this.#linkButton.dataset.active = 'true'
    this.#toolbar.hidden = false
    this.#updateLinkControls()
    this.#position()
    requestAnimationFrame(() => {
      this.#linkInput.focus()
      this.#linkInput.select()
    })
  }

  #updateLinkControls(): void {
    const normalized = normalizeEditableLink(this.#linkInput.value)
    const invalid = normalized === undefined
    this.#linkInput.setAttribute('aria-invalid', String(invalid))
    this.#linkMessage.textContent = invalid ? '仅支持安全链接或相对路径。' : ''
    this.#confirmLinkButton.disabled = invalid
    this.#openLinkButton.disabled = invalid || !normalized || !isExternalLink(normalized)
    this.#removeLinkButton.hidden = !this.#linkRange?.mark
  }

  #applyLink(): void {
    const href = normalizeEditableLink(this.#linkInput.value)
    const range = this.#linkRange
    const linkType = this.#view.state.schema.marks.link
    if (href === undefined || !range || !linkType) return
    let transaction = this.#view.state.tr
    transaction = transaction.removeMark(range.from, range.to, linkType)
    if (href) {
      if (range.from === range.to) {
        transaction = transaction.insertText(href, range.from)
        transaction = transaction.addMark(
          range.from,
          range.from + href.length,
          linkType.create({ href }),
        )
      } else {
        transaction = transaction.addMark(range.from, range.to, linkType.create({ href }))
      }
    }
    this.#view.dispatch(transaction.scrollIntoView())
    this.#linkEditing = false
    this.#linkEditor.hidden = true
    this.#linkButton.dataset.active = 'false'
    this.#view.focus()
    this.update(this.#view)
  }

  #removeLink(): void {
    if (!this.#linkRange || !this.#view.state.schema.marks.link) return
    this.#view.dispatch(
      this.#view.state.tr
        .removeMark(this.#linkRange.from, this.#linkRange.to, this.#view.state.schema.marks.link)
        .scrollIntoView(),
    )
    this.#linkEditing = false
    this.#linkEditor.hidden = true
    this.#linkButton.dataset.active = 'false'
    this.#view.focus()
  }

  async #openExternal(value: string): Promise<void> {
    const href = normalizeEditableLink(value)
    if (!href || !isExternalLink(href)) {
      this.#options.onError?.('只有 http、https 或 mailto 链接可以在系统中打开。')
      return
    }
    try {
      await this.#options.openExternalUrl(href)
    } catch (error) {
      this.#options.onError?.(error instanceof Error ? error.message : '无法打开外部链接。')
    }
  }

  #dismiss(): void {
    this.#dismissedSelection = this.#selectionKey(this.#view.state)
    this.#linkEditing = false
    this.#linkEditor.hidden = true
    this.#linkButton.dataset.active = 'false'
    this.#hide()
    this.#view.focus()
  }

  #hide(): void {
    this.#toolbar.hidden = true
  }

  #position(): void {
    const { from, to } = this.#view.state.selection
    const start = this.#view.coordsAtPos(from)
    const end = this.#view.coordsAtPos(to)
    const width = this.#toolbar.offsetWidth
    const height = this.#toolbar.offsetHeight
    const selectionCenter = (start.left + end.right) / 2
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, selectionCenter - width / 2))
    const preferredTop = Math.min(start.top, end.top) - height - 10
    const top = preferredTop >= 8 ? preferredTop : Math.max(start.bottom, end.bottom) + 10
    this.#toolbar.style.left = `${Math.round(left)}px`
    this.#toolbar.style.top = `${Math.round(top)}px`
  }

  update(view: EditorView, previousState?: EditorState): void {
    const key = this.#selectionKey(view.state)
    if (key !== this.#lastSelection) {
      this.#lastSelection = key
      if (!this.#linkEditing) this.#dismissedSelection = undefined
    }
    const selection = view.state.selection
    const selectionValid =
      selection instanceof TextSelection && (!selection.empty || this.#linkEditing)
    const toolbarHasFocus = this.#toolbar.contains(document.activeElement)
    if (
      !view.editable ||
      view.composing ||
      !selectionValid ||
      this.#dismissedSelection === key ||
      (!view.hasFocus() && !toolbarHasFocus)
    ) {
      if (!this.#linkEditing) this.#hide()
      return
    }

    for (const [command, button] of this.#buttonByCommand) {
      const markType = view.state.schema.marks[command]
      const active = Boolean(
        markType &&
          (selection.empty
            ? markType.isInSet(view.state.storedMarks ?? selection.$from.marks())
            : view.state.doc.rangeHasMark(selection.from, selection.to, markType)),
      )
      button.dataset.active = String(active)
      button.setAttribute('aria-pressed', String(active))
    }
    if (
      previousState &&
      previousState.doc.eq(view.state.doc) &&
      previousState.selection.eq(selection)
    ) {
      return
    }
    this.#toolbar.hidden = false
    this.#position()
  }

  destroy(): void {
    this.#view.dom.removeEventListener('keydown', this.#onEditorKeyDown, true)
    this.#view.dom.removeEventListener('click', this.#onEditorClick, true)
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown, true)
    this.#toolbar.remove()
  }
}

export function createOpenMdFormattingFeature(options: FormattingFeatureOptions) {
  return $prose(
    () =>
      new Plugin({
        view: (view) => new FormattingToolbarView(view, options),
      }),
  )
}
