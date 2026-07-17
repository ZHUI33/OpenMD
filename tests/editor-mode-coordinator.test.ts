import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EditorModeCoordinator } from '../src/renderer/src/editor/editor-coordinator'
import type {
  CursorAnchor,
  EditorDocumentAdapter,
  EditorMode,
} from '../src/renderer/src/editor/editor.types'
import { useAppStore } from '../src/renderer/src/stores/app-store'

class FakeEditorAdapter implements EditorDocumentAdapter {
  readonly setMarkdownCalls: string[] = []
  readonly restoredAnchors: CursorAnchor[] = []
  focusCount = 0

  constructor(
    public markdown: string,
    public cursorAnchor?: CursorAnchor,
  ) {}

  getMarkdown(): string {
    return this.markdown
  }

  setMarkdown(markdown: string): void {
    this.markdown = markdown
    this.setMarkdownCalls.push(markdown)
  }

  focus(): void {
    this.focusCount += 1
  }

  getCursorAnchor(): CursorAnchor | undefined {
    return this.cursorAnchor
  }

  restoreCursorAnchor(anchor: CursorAnchor): void {
    this.restoredAnchors.push(anchor)
  }
}

function switchAndAttach(
  coordinator: EditorModeCoordinator,
  mode: EditorMode,
  adapter: FakeEditorAdapter,
): void {
  expect(coordinator.switchMode(mode)).toBe(true)
  expect(coordinator.attach(mode, adapter)).toBe(true)
  coordinator.markReady(adapter)
}

describe('editor mode coordinator', () => {
  beforeEach(() => {
    useAppStore.getState().setDocument('saved')
    useAppStore.getState().setEditorMode('visual')
  })

  it('defaults to visual mode and synchronizes visual Markdown before entering source mode', () => {
    const changes: string[] = []
    const coordinator = new EditorModeCoordinator({
      initialMarkdown: 'initial',
      onChange: (markdown) => changes.push(markdown),
    })
    const visual = new FakeEditorAdapter('initial', {
      headingText: '当前章节',
      blockIndex: 2,
    })
    const source = new FakeEditorAdapter('stale')

    expect(coordinator.getMode()).toBe('visual')
    expect(coordinator.attach('visual', visual)).toBe(true)
    visual.markdown = '# 当前章节\n\n视觉模式的最新正文'

    switchAndAttach(coordinator, 'source', source)

    expect(changes).toEqual(['# 当前章节\n\n视觉模式的最新正文'])
    expect(source.markdown).toBe('# 当前章节\n\n视觉模式的最新正文')
    expect(source.restoredAnchors).toEqual([{ headingText: '当前章节', blockIndex: 2 }])
  })

  it('synchronizes exact source text back to visual mode and ignores stale callbacks', () => {
    const onChange = vi.fn()
    const coordinator = new EditorModeCoordinator({
      initialMarkdown: '',
      initialMode: 'source',
      onChange,
    })
    const source = new FakeEditorAdapter('')
    const visual = new FakeEditorAdapter('old')
    const markdown = [
      '# 中文',
      '',
      '| 列 | 值 |',
      '| --- | --- |',
      '| 公式 | $E=mc^2$ |',
      '',
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '',
      '![图片](./assets/demo.png)',
    ].join('\n')

    coordinator.attach('source', source)
    source.markdown = markdown
    expect(coordinator.acceptChange(source, markdown)).toBe(true)
    switchAndAttach(coordinator, 'visual', visual)

    expect(visual.markdown).toBe(markdown)
    expect(coordinator.acceptChange(source, '迟到的源码回调')).toBe(false)
    expect(coordinator.getMarkdown()).toBe(markdown)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('rejects obsolete attachments during rapid continuous switching', () => {
    const coordinator = new EditorModeCoordinator({ initialMarkdown: '快速切换' })
    const visual = new FakeEditorAdapter('快速切换')
    const staleSource = new FakeEditorAdapter('stale')
    const finalSource = new FakeEditorAdapter('')

    coordinator.attach('visual', visual)
    coordinator.switchMode('source')
    coordinator.switchMode('visual')
    coordinator.switchMode('source')

    expect(coordinator.attach('visual', visual)).toBe(false)
    expect(coordinator.attach('visual', staleSource)).toBe(false)
    expect(coordinator.attach('source', finalSource)).toBe(true)
    expect(finalSource.markdown).toBe('快速切换')
    expect(coordinator.acceptChange(visual, '旧实例修改')).toBe(false)
  })

  it.each([
    ['', '空文档'],
    ['纯中文内容\n\n第二段', '中文文档'],
    ['| A | B |\n| - | - |\n| 1 | 2 |\n\n$$x^2$$\n\n![图](a.png)', '复杂语法'],
  ])('round-trips %s through both adapters (%s)', (markdown) => {
    const coordinator = new EditorModeCoordinator({ initialMarkdown: markdown })
    const visual = new FakeEditorAdapter(markdown)
    const source = new FakeEditorAdapter('not current')
    coordinator.attach('visual', visual)

    switchAndAttach(coordinator, 'source', source)
    switchAndAttach(coordinator, 'visual', visual)

    expect(coordinator.getMarkdown()).toBe(markdown)
  })

  it('updates dirty state only for accepted active-editor changes', () => {
    const coordinator = new EditorModeCoordinator({
      initialMarkdown: 'saved',
      onChange: useAppStore.getState().updateMarkdown,
    })
    const visual = new FakeEditorAdapter('saved')
    const source = new FakeEditorAdapter('')
    coordinator.attach('visual', visual)

    visual.markdown = 'changed'
    expect(coordinator.acceptChange(visual, 'changed')).toBe(true)
    expect(useAppStore.getState().document.dirty).toBe(true)
    switchAndAttach(coordinator, 'source', source)
    expect(coordinator.acceptChange(visual, 'stale')).toBe(false)
    expect(useAppStore.getState().document.markdown).toBe('changed')

    source.markdown = 'saved'
    expect(coordinator.acceptChange(source, 'saved')).toBe(true)
    expect(useAppStore.getState().document.dirty).toBe(false)
  })

  it('keeps a transition-time snapshot available for save and suppresses setMarkdown callbacks', () => {
    const onChange = vi.fn()
    const coordinator = new EditorModeCoordinator({ initialMarkdown: 'old', onChange })
    const visual = new FakeEditorAdapter('old')
    coordinator.attach('visual', visual)
    visual.markdown = 'latest before switch'

    coordinator.switchMode('source')
    expect(coordinator.getMarkdown()).toBe('latest before switch')

    coordinator.setMarkdown('opened document')
    expect(coordinator.getMarkdown()).toBe('opened document')
    expect(onChange).toHaveBeenCalledOnce()
  })
})
