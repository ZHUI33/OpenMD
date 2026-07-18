declare module 'markdown-it-katex' {
  import type MarkdownIt from 'markdown-it'

  const markdownItKatex: (markdownIt: MarkdownIt) => void
  export default markdownItKatex
}

declare module '*?raw' {
  const source: string
  export default source
}
