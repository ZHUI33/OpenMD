import type { JSX } from 'react'

export function EditorPlaceholder(): JSX.Element {
  return (
    <section className="editor-placeholder" aria-labelledby="editor-placeholder-title">
      <div className="placeholder-symbol" aria-hidden="true">
        M↓
      </div>
      <h1 id="editor-placeholder-title">开始书写</h1>
      <p>Markdown 正文编辑体验将在后续阶段实现。</p>
    </section>
  )
}
