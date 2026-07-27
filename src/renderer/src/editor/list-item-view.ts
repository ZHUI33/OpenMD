import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView, NodeView, ViewMutationRecord } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

class OpenMdListItemNodeView implements NodeView {
  readonly dom: HTMLLIElement
  readonly contentDOM: HTMLDivElement
  private readonly checkbox: HTMLInputElement
  private node: ProseMirrorNode

  constructor(
    node: ProseMirrorNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.node = node
    const ownerDocument = view.dom.ownerDocument
    this.dom = ownerDocument.createElement('li')
    this.dom.className = 'openmd-list-item'
    this.contentDOM = ownerDocument.createElement('div')
    this.contentDOM.className = 'openmd-list-item__content'
    this.checkbox = ownerDocument.createElement('input')
    this.checkbox.type = 'checkbox'
    this.checkbox.className = 'openmd-task-checkbox'
    this.checkbox.contentEditable = 'false'
    this.checkbox.setAttribute('aria-label', '切换任务完成状态')
    this.checkbox.addEventListener('change', this.onCheckboxChange)
    this.render()
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render()
    return true
  }

  stopEvent(event: Event): boolean {
    return event.target === this.checkbox
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.target === this.checkbox || this.checkbox.contains(mutation.target)
  }

  destroy(): void {
    this.checkbox.removeEventListener('change', this.onCheckboxChange)
  }

  private render(): void {
    const checked = this.node.attrs.checked
    const isTask = typeof checked === 'boolean'
    this.dom.dataset.itemType = isTask ? 'task' : 'list'
    this.dom.dataset.checked = isTask ? String(checked) : ''
    this.dom.dataset.listType = String(this.node.attrs.listType ?? 'bullet')
    this.dom.dataset.label = String(this.node.attrs.label ?? '•')
    this.dom.dataset.spread = String(this.node.attrs.spread ?? true)
    this.checkbox.checked = checked === true
    this.checkbox.disabled = !this.view.editable
    if (isTask) {
      if (this.dom.firstChild !== this.checkbox) this.dom.prepend(this.checkbox)
      if (this.contentDOM.parentElement !== this.dom) this.dom.append(this.contentDOM)
    } else {
      this.checkbox.remove()
      if (this.contentDOM.parentElement !== this.dom) this.dom.append(this.contentDOM)
    }
  }

  private onCheckboxChange = (): void => {
    if (!this.view.editable) return
    const position = this.getPos()
    if (position === undefined) return
    const current = this.view.state.doc.nodeAt(position)
    if (!current || current.type !== this.node.type || typeof current.attrs.checked !== 'boolean') {
      return
    }
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(position, undefined, {
        ...current.attrs,
        checked: this.checkbox.checked,
      }),
    )
    this.view.focus()
  }
}

/**
 * Crepe's Vue list NodeView restores an obsolete resolved selection from a
 * delayed animation frame. Structural compatibility plugins can legitimately
 * update the document before that frame, causing an uncaught ProseMirror
 * exception. This small DOM NodeView has no delayed selection side effects and
 * keeps GFM task checkboxes fully interactive.
 */
export const openMdListItemView = $prose(
  () =>
    new Plugin({
      key: new PluginKey('openmd-list-item-view'),
      props: {
        nodeViews: {
          list_item: (node, view, getPos) => new OpenMdListItemNodeView(node, view, getPos),
        },
      },
    }),
)
