import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx } from '@milkdown/kit/core'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  selectColCommand,
  setAlignCommand,
} from '@milkdown/kit/preset/gfm'
import { Plugin, PluginKey, Selection } from '@milkdown/kit/prose/state'
import type { EditorState, PluginView } from '@milkdown/kit/prose/state'
import {
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect,
} from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export type TableContextAction =
  | 'add-row-before'
  | 'add-row-after'
  | 'add-column-before'
  | 'add-column-after'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'

interface TableActionDefinition {
  action: TableContextAction
  label: string
  group: number
  danger?: boolean
  unavailableInHeader?: boolean
}

const actionDefinitions: TableActionDefinition[] = [
  {
    action: 'add-row-before',
    label: '在上方插入行',
    group: 0,
    unavailableInHeader: true,
  },
  { action: 'add-row-after', label: '在下方插入行', group: 0 },
  { action: 'add-column-before', label: '在左侧插入列', group: 0 },
  { action: 'add-column-after', label: '在右侧插入列', group: 0 },
  { action: 'align-left', label: '列左对齐', group: 1 },
  { action: 'align-center', label: '列居中', group: 1 },
  { action: 'align-right', label: '列右对齐', group: 1 },
  {
    action: 'delete-row',
    label: '删除行',
    group: 2,
    danger: true,
    unavailableInHeader: true,
  },
  { action: 'delete-column', label: '删除列', group: 2, danger: true },
  { action: 'delete-table', label: '删除表格', group: 2, danger: true },
]

const tableContextMenuKey = new PluginKey('openmd-table-context-menu')

const menuStyles = `
.openmd-table-context-menu {
  position: fixed;
  z-index: 1200;
  display: none;
  min-width: 172px;
  padding: 6px;
  overflow: hidden;
  border: 1px solid var(--border, #d8dee9);
  border-radius: 10px;
  background: var(--surface, #fff);
  box-shadow: var(--shadow, 0 10px 30px rgb(0 0 0 / 16%));
  color: var(--foreground, #1f2937);
  font: 13px/1.4 var(--crepe-font-default, inherit);
}

.openmd-table-context-menu[data-open='true'] {
  display: block;
}

.openmd-table-context-menu button {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: default;
  text-align: left;
}

.openmd-table-context-menu button:hover,
.openmd-table-context-menu button:focus-visible {
  outline: none;
  background: var(--surface-subtle, #f3f4f6);
}

.openmd-table-context-menu button:disabled {
  opacity: 0.42;
}

.openmd-table-context-menu button[data-danger='true'] {
  color: var(--danger, #b42318);
}

.openmd-table-context-menu button[data-group-start='true'] {
  margin-top: 5px;
  padding-top: 10px;
  border-top: 1px solid var(--border, #d8dee9);
  border-radius: 0 0 6px 6px;
}
`

interface ActiveTableContext {
  columnIndex: number
  isHeaderRow: boolean
}

function activeTableContext(state: EditorState): ActiveTableContext | undefined {
  if (!isInTable(state)) return undefined
  const rect = selectedRect(state)
  return { columnIndex: rect.left, isHeaderRow: rect.top === 0 }
}

/** Run a table operation against the current cell/column selection. */
export function runTableContextAction(
  ctx: Ctx,
  view: EditorView,
  action: TableContextAction,
): boolean {
  const active = activeTableContext(view.state)
  if (!active || !view.editable) return false

  const commands = ctx.get(commandsCtx)
  switch (action) {
    case 'add-row-before':
      if (active.isHeaderRow) return false
      return commands.call(addRowBeforeCommand.key)
    case 'add-row-after':
      return commands.call(addRowAfterCommand.key)
    case 'add-column-before':
      return commands.call(addColBeforeCommand.key)
    case 'add-column-after':
      return commands.call(addColAfterCommand.key)
    case 'delete-row':
      if (active.isHeaderRow) return false
      return deleteRow(view.state, view.dispatch)
    case 'delete-column':
      return deleteColumn(view.state, view.dispatch)
    case 'delete-table':
      return deleteTable(view.state, view.dispatch)
    case 'align-left':
    case 'align-center':
    case 'align-right': {
      const alignment = action.slice('align-'.length) as 'left' | 'center' | 'right'
      // Milkdown's select-column command dispatches successfully but returns
      // false because ProseMirror dispatch itself is void. Apply alignment
      // against the synchronously updated column selection regardless.
      commands.call(selectColCommand.key, { index: active.columnIndex })
      return commands.call(setAlignCommand.key, alignment)
    }
  }
}

class TableContextMenuView implements PluginView {
  private readonly menu: HTMLDivElement
  private readonly style: HTMLStyleElement
  private readonly buttons = new Map<TableContextAction, HTMLButtonElement>()
  private readonly ownerDocument: Document
  private readonly ownerWindow: Window | null
  private isOpen = false

  constructor(
    private readonly ctx: Ctx,
    private view: EditorView,
  ) {
    this.ownerDocument = view.dom.ownerDocument
    this.ownerWindow = this.ownerDocument.defaultView
    this.style = this.ownerDocument.createElement('style')
    this.style.dataset.openmdTableMenuStyle = 'true'
    this.style.textContent = menuStyles
    ;(this.ownerDocument.head ?? this.ownerDocument.documentElement).appendChild(this.style)

    this.menu = this.ownerDocument.createElement('div')
    this.menu.className = 'openmd-table-context-menu'
    this.menu.dataset.open = 'false'
    this.menu.setAttribute('role', 'menu')
    this.menu.setAttribute('aria-label', '表格操作')
    this.buildMenu()
    this.ownerDocument.body.appendChild(this.menu)

    this.ownerDocument.addEventListener('pointerdown', this.onDocumentPointerDown, true)
    this.ownerDocument.addEventListener('keydown', this.onDocumentKeyDown, true)
    this.ownerDocument.addEventListener('scroll', this.onViewportChange, true)
    this.ownerWindow?.addEventListener('resize', this.onViewportChange)
  }

  update = (view: EditorView, previousState: EditorState): void => {
    this.view = view
    if (
      this.isOpen &&
      (previousState.doc !== view.state.doc || !previousState.selection.eq(view.state.selection))
    ) {
      this.hide()
    }
  }

  open = (event: MouseEvent): boolean => {
    if (!this.view.editable || this.view.composing) {
      this.hide()
      return false
    }

    const target = event.target
    if (!(target instanceof Element)) {
      this.hide()
      return false
    }

    const cell = target.closest('td, th')
    if (!cell || !this.view.dom.contains(cell)) {
      this.hide()
      return false
    }

    if (!this.moveSelectionIntoCell(cell)) return false
    const active = activeTableContext(this.view.state)
    if (!active) return false

    event.preventDefault()
    this.updateAvailability(active)
    this.menu.dataset.open = 'true'
    this.isOpen = true
    this.place(event.clientX, event.clientY)
    this.firstEnabledButton()?.focus({ preventScroll: true })
    return true
  }

  hide = (): void => {
    if (!this.isOpen) return
    this.isOpen = false
    this.menu.dataset.open = 'false'
  }

  destroy = (): void => {
    this.ownerDocument.removeEventListener('pointerdown', this.onDocumentPointerDown, true)
    this.ownerDocument.removeEventListener('keydown', this.onDocumentKeyDown, true)
    this.ownerDocument.removeEventListener('scroll', this.onViewportChange, true)
    this.ownerWindow?.removeEventListener('resize', this.onViewportChange)
    this.menu.remove()
    this.style.remove()
  }

  private buildMenu(): void {
    let previousGroup = actionDefinitions[0]?.group
    for (const definition of actionDefinitions) {
      const button = this.ownerDocument.createElement('button')
      button.type = 'button'
      button.textContent = definition.label
      button.dataset.action = definition.action
      button.dataset.danger = String(Boolean(definition.danger))
      button.dataset.groupStart = String(definition.group !== previousGroup)
      button.setAttribute('role', 'menuitem')
      button.addEventListener('pointerdown', (event) => event.preventDefault())
      button.addEventListener('click', () => this.execute(definition.action))
      this.buttons.set(definition.action, button)
      this.menu.appendChild(button)
      previousGroup = definition.group
    }
  }

  private moveSelectionIntoCell(cell: Element): boolean {
    try {
      const position = this.view.posAtDOM(cell, 0)
      const selection = Selection.near(this.view.state.doc.resolve(position), 1)
      this.view.dispatch(this.view.state.tr.setSelection(selection))
      return isInTable(this.view.state)
    } catch {
      return false
    }
  }

  private updateAvailability(active: ActiveTableContext): void {
    for (const definition of actionDefinitions) {
      const button = this.buttons.get(definition.action)
      if (!button) continue
      button.disabled = Boolean(definition.unavailableInHeader && active.isHeaderRow)
    }
  }

  private place(clientX: number, clientY: number): void {
    const viewportWidth =
      this.ownerWindow?.innerWidth ?? this.ownerDocument.documentElement.clientWidth
    const viewportHeight =
      this.ownerWindow?.innerHeight ?? this.ownerDocument.documentElement.clientHeight
    const bounds = this.menu.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(clientX, viewportWidth - bounds.width - margin))
    const top = Math.max(margin, Math.min(clientY, viewportHeight - bounds.height - margin))
    this.menu.style.left = `${left}px`
    this.menu.style.top = `${top}px`
  }

  private firstEnabledButton(): HTMLButtonElement | undefined {
    return [...this.buttons.values()].find((button) => !button.disabled)
  }

  private execute(action: TableContextAction): void {
    const handled = runTableContextAction(this.ctx, this.view, action)
    this.hide()
    if (handled) this.ownerWindow?.requestAnimationFrame(() => this.view.focus())
  }

  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (!this.isOpen || this.menu.contains(event.target as Node)) return
    this.hide()
  }

  private onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen || event.key !== 'Escape') return
    event.preventDefault()
    this.hide()
    this.view.focus()
  }

  private onViewportChange = (): void => this.hide()
}

/** A compact right-click menu that complements Crepe's built-in table handles. */
export const tableContextMenuPlugin = $prose((ctx) => {
  let menuView: TableContextMenuView | undefined

  return new Plugin({
    key: tableContextMenuKey,
    props: {
      handleDOMEvents: {
        contextmenu: (_view, event) => menuView?.open(event as MouseEvent) ?? false,
      },
    },
    view: (view) => {
      const current = new TableContextMenuView(ctx, view)
      menuView = current
      return {
        update: current.update,
        destroy: () => {
          current.destroy()
          if (menuView === current) menuView = undefined
        },
      }
    },
  })
})
