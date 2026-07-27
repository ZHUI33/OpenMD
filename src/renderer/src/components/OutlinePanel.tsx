import type { JSX } from 'react'

import type { OutlineItem } from '../editor/outline-feature'

interface OutlinePanelProps {
  activeId: string | null
  items: readonly OutlineItem[]
  onNavigate: (id: string) => void
}

function OutlineBranch({
  activeId,
  items,
  onNavigate,
}: Pick<OutlinePanelProps, 'activeId' | 'items' | 'onNavigate'>): JSX.Element {
  return (
    <ol className="openmd-outline-list">
      {items.map((item) => (
        <li key={item.id} className="openmd-outline-item">
          <button
            type="button"
            className="openmd-outline-link"
            data-active={item.id === activeId}
            data-level={item.level}
            aria-current={item.id === activeId ? 'location' : undefined}
            title={item.text || '无标题'}
            onClick={() => onNavigate(item.id)}
          >
            {item.text || '无标题'}
          </button>
          {item.children.length > 0 ? (
            <OutlineBranch activeId={activeId} items={item.children} onNavigate={onNavigate} />
          ) : null}
        </li>
      ))}
    </ol>
  )
}

export function OutlinePanel({ activeId, items, onNavigate }: OutlinePanelProps): JSX.Element {
  return (
    <section className="openmd-outline-panel" aria-label="文档大纲">
      <div className="sidebar-panel-heading">文档大纲</div>
      <nav className="openmd-outline-nav" aria-label="标题导航">
        {items.length > 0 ? (
          <OutlineBranch activeId={activeId} items={items} onNavigate={onNavigate} />
        ) : (
          <p className="openmd-outline-empty">暂无标题</p>
        )}
      </nav>
    </section>
  )
}
