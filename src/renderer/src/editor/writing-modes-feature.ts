import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

import type { TypewriterBehavior } from '../../../shared/settings'

export interface WritingModeConfiguration {
  focusMode: boolean
  typewriterMode: boolean
  typewriterBehavior: TypewriterBehavior
}

interface WritingModePluginState {
  decorations: DecorationSet
}

const writingModePluginKey = new PluginKey<WritingModePluginState>('openmd-writing-modes')

function activeBlockDecorations(state: EditorState): DecorationSet {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (!node.isBlock) continue
    const from = $from.before(depth)
    return DecorationSet.create(state.doc, [
      Decoration.node(from, from + node.nodeSize, {
        class: 'openmd-focus-block',
        'data-openmd-focus-block': 'true',
      }),
    ])
  }
  return DecorationSet.empty
}

function scrollContainer(element: HTMLElement): HTMLElement | Window {
  const ownerWindow = element.ownerDocument.defaultView ?? window
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = ownerWindow.getComputedStyle(parent)
    if (/(auto|scroll|overlay)/u.test(`${style.overflowY} ${style.overflow}`)) return parent
  }
  return ownerWindow
}

export class RafCaretCenterer {
  private frame: number | undefined

  constructor(
    private readonly ownerWindow: Window,
    private readonly host: HTMLElement,
    private readonly readCaretTop: () => number | undefined,
  ) {}

  schedule(): void {
    if (this.frame !== undefined) return
    this.frame = this.ownerWindow.requestAnimationFrame(() => {
      this.frame = undefined
      const caretTop = this.readCaretTop()
      if (caretTop === undefined) return
      const scroller = scrollContainer(this.host)
      if (scroller instanceof Window) {
        const viewportCenter = scroller.innerHeight / 2
        scroller.scrollBy({ top: caretTop - viewportCenter, behavior: 'auto' })
        return
      }
      const rectangle = scroller.getBoundingClientRect()
      const viewportCenter = rectangle.top + rectangle.height / 2
      scroller.scrollTop = Math.max(0, scroller.scrollTop + caretTop - viewportCenter)
    })
  }

  cancel(): void {
    if (this.frame !== undefined) this.ownerWindow.cancelAnimationFrame(this.frame)
    this.frame = undefined
  }
}

export class VisualWritingModeController {
  private view?: EditorView
  private centerer?: RafCaretCenterer
  private inputIntent = false
  private keyboardIntent = false
  private configuration: WritingModeConfiguration

  constructor(configuration: WritingModeConfiguration) {
    this.configuration = configuration
  }

  setConfiguration(configuration: WritingModeConfiguration): void {
    this.configuration = configuration
  }

  attach(view: EditorView): void {
    this.view = view
    const ownerWindow = view.dom.ownerDocument.defaultView ?? window
    this.centerer = new RafCaretCenterer(ownerWindow, view.dom, () => {
      try {
        return view.coordsAtPos(view.state.selection.head).top
      } catch {
        return undefined
      }
    })
    view.dom.addEventListener('beforeinput', this.onBeforeInput, true)
    view.dom.addEventListener('input', this.onInput, true)
    view.dom.addEventListener('keydown', this.onKeyDown, true)
    view.dom.addEventListener('pointerdown', this.onPointerDown, true)
  }

  update(view: EditorView, previousState: EditorState): void {
    this.view = view
    const documentChanged = previousState.doc !== view.state.doc
    const selectionChanged = !previousState.selection.eq(view.state.selection)
    const { typewriterMode, typewriterBehavior } = this.configuration
    const shouldCenter =
      typewriterMode &&
      ((documentChanged && (this.inputIntent || view.hasFocus())) ||
        (typewriterBehavior === 'always' && selectionChanged && this.keyboardIntent))
    this.inputIntent = false
    this.keyboardIntent = false
    if (shouldCenter) this.centerer?.schedule()
  }

  detach(view: EditorView): void {
    if (this.view !== view) return
    view.dom.removeEventListener('beforeinput', this.onBeforeInput, true)
    view.dom.removeEventListener('input', this.onInput, true)
    view.dom.removeEventListener('keydown', this.onKeyDown, true)
    view.dom.removeEventListener('pointerdown', this.onPointerDown, true)
    this.centerer?.cancel()
    this.centerer = undefined
    this.view = undefined
  }

  private readonly onBeforeInput = (): void => {
    this.inputIntent = true
  }

  private readonly onInput = (): void => {
    if (this.configuration.typewriterMode) this.centerer?.schedule()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      event.key.startsWith('Arrow') ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown'
    ) {
      this.keyboardIntent = true
    }
  }

  private readonly onPointerDown = (): void => {
    this.inputIntent = false
    this.keyboardIntent = false
  }
}

export function createWritingModesFeature(configuration: WritingModeConfiguration) {
  const controller = new VisualWritingModeController(configuration)
  const proseMirrorPlugin = new Plugin<WritingModePluginState>({
    key: writingModePluginKey,
    state: {
      init: (_, state) => ({ decorations: activeBlockDecorations(state) }),
      apply: (transaction, pluginState, _oldState, newState) => {
        if (transaction.selectionSet || transaction.docChanged) {
          return { decorations: activeBlockDecorations(newState) }
        }
        return pluginState
      },
    },
    props: {
      decorations: (state) => writingModePluginKey.getState(state)?.decorations,
    },
    view: (view) => {
      controller.attach(view)
      return {
        update: (nextView, previousState) => controller.update(nextView, previousState),
        destroy: () => controller.detach(view),
      }
    },
  })
  return {
    controller,
    proseMirrorPlugin,
    plugin: $prose(() => proseMirrorPlugin),
  }
}
