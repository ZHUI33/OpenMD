import type { JSX } from 'react'

export function StatusBar(): JSX.Element {
  return (
    <footer className="status-bar">
      <span>就绪</span>
      <span>阶段 1 · 项目骨架</span>
    </footer>
  )
}
