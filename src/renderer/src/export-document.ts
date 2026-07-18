import DOMPurify from 'dompurify'
import hljs from 'highlight.js'
import highlightCss from 'highlight.js/styles/github.css?raw'
import katexCss from 'katex/dist/katex.min.css?raw'
import MarkdownIt from 'markdown-it'
import markdownItKatex from 'markdown-it-katex'

import type { HtmlImageStrategy, ImagesApi } from '../../shared/desktop-api.types'
import {
  createMermaidRenderId,
  OPENMD_MERMAID_CONFIG,
  sanitizeMermaidSvg,
  validateMermaidSourceSafety,
} from './editor/mermaid-feature'

const EXPORT_STYLES = String.raw`
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #fff; }
body {
  margin: 0 auto;
  max-width: 900px;
  padding: 48px 42px 72px;
  background: #fff;
  color: #20201e;
  font: 16px/1.7 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-wrap: anywhere;
}
article { min-width: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.28; margin: 1.45em 0 .6em; page-break-after: avoid; }
h1 { font-size: 2.15em; border-bottom: 1px solid #dfdfda; padding-bottom: .3em; }
h2 { font-size: 1.65em; border-bottom: 1px solid #e9e9e4; padding-bottom: .22em; }
p, ul, ol, blockquote, pre, table { margin: .85em 0; }
a { color: #0969da; text-decoration-thickness: .08em; text-underline-offset: .18em; }
blockquote { margin-left: 0; padding: .15em 1em; color: #555; border-left: 4px solid #d0d7de; }
hr { border: 0; border-top: 1px solid #d8dee4; margin: 2em 0; }
img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
table { width: 100%; border-collapse: collapse; border-spacing: 0; font-size: .95em; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th, td { border: 1px solid #d0d7de; padding: .48em .7em; text-align: left; vertical-align: top; }
th { background: #f3f4f6; font-weight: 650; }
tbody tr:nth-child(even) td { background: #fafafa; }
pre { overflow-x: auto; padding: 1em 1.1em; border: 1px solid #e2e5e9; border-radius: 7px; background: #f6f8fa; white-space: pre-wrap; overflow-wrap: normal; }
pre code { white-space: pre-wrap; overflow-wrap: normal; word-break: normal; }
:not(pre) > code { padding: .14em .35em; border-radius: 4px; background: #eff1f3; font: .9em ui-monospace, SFMono-Regular, Consolas, monospace; }
.katex { font-family: KaTeX_Main, "Times New Roman", serif; }
.katex-display { overflow-x: auto; overflow-y: hidden; padding: .4em 0; }
.openmd-export-mermaid { margin: 1.1em 0; overflow-x: auto; text-align: center; break-inside: avoid; }
.openmd-export-mermaid svg { display: block; width: auto; max-width: 100%; height: auto; margin: 0 auto; }
.openmd-export-mermaid-error { color: #b42318; border-color: #f0b7b2; }
@media print {
  body { max-width: none; padding: 0; color: #111; }
  a { color: #111; text-decoration: underline; }
  pre, blockquote, img, .katex-display, .openmd-export-mermaid { break-inside: avoid; page-break-inside: avoid; }
  table { break-inside: auto; page-break-inside: auto; }
  th, td { background: #fff !important; }
}
`

const STANDALONE_KATEX_CSS = katexCss
  .replace(/@font-face\s*\{[^}]*\}/gu, '')
  .replace(/font-family:\s*KaTeX_[^;}]+/gu, 'font-family: "Times New Roman", serif')

export interface BuildStandaloneHtmlOptions {
  markdown: string
  title: string
  documentPath?: string
  imageStrategy: HtmlImageStrategy
  imagesApi: Pick<ImagesApi, 'resolveImage'>
  createdAt?: Date
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function createMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    highlight: (source, language) => {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(source, { language, ignoreIllegals: true }).value
      }
      return escapeHtml(source)
    },
  }).use(markdownItKatex)

  const defaultFence = renderer.renderer.rules.fence!
  renderer.renderer.rules.fence = (tokens, index, options, environment, self) => {
    const language = tokens[index].info.trim().split(/\s+/u, 1)[0]?.toLocaleLowerCase('en-US')
    if (language !== 'mermaid') return defaultFence(tokens, index, options, environment, self)
    return `<div class="openmd-export-mermaid-source"><pre><code>${escapeHtml(tokens[index].content)}</code></pre></div>`
  }
  return renderer
}

function sanitizedFragment(dirtyHtml: string): DocumentFragment {
  return DOMPurify.sanitize(dirtyHtml, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['srcdoc'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto):|data:image\/(?:png|jpeg|gif|webp|svg\+xml);|(?:\.{0,2}\/|#|[^:/?#]+(?:[/?#]|$)))/i,
    RETURN_DOM_FRAGMENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as unknown as DocumentFragment
}

async function renderMermaidDiagrams(container: HTMLElement): Promise<void> {
  const placeholders = [...container.querySelectorAll<HTMLElement>('.openmd-export-mermaid-source')]
  if (placeholders.length === 0) return

  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ ...OPENMD_MERMAID_CONFIG })
  for (const placeholder of placeholders) {
    const source = placeholder.textContent ?? ''
    const renderHost = document.createElement('div')
    renderHost.hidden = true
    document.body.appendChild(renderHost)
    const renderId = createMermaidRenderId()
    try {
      validateMermaidSourceSafety(source)
      const { svg } = await mermaid.render(renderId, source, renderHost)
      const preview = sanitizeMermaidSvg(svg, document)
      preview.className = 'openmd-export-mermaid'
      preview.removeAttribute('id')
      placeholder.replaceWith(preview)
    } catch (error) {
      const failure = document.createElement('pre')
      failure.className = 'openmd-export-mermaid-error'
      const code = document.createElement('code')
      code.textContent = `Mermaid 图表无法渲染：${error instanceof Error ? error.message : '语法错误'}\n\n${source}`
      failure.appendChild(code)
      placeholder.replaceWith(failure)
    } finally {
      renderHost.remove()
      document.getElementById(`d${renderId}`)?.remove()
    }
  }
}

async function applyImageStrategy(
  container: HTMLElement,
  options: BuildStandaloneHtmlOptions,
): Promise<void> {
  if (options.imageStrategy !== 'base64' || !options.documentPath) return
  await Promise.all(
    [...container.querySelectorAll<HTMLImageElement>('img[src]')].map(async (image) => {
      const source = image.getAttribute('src')?.trim()
      if (!source || source.startsWith('data:') || /^https?:\/\//iu.test(source)) return
      const result = await options.imagesApi.resolveImage({
        documentPath: options.documentPath!,
        source,
      })
      if (result.ok && result.url?.startsWith('data:image/')) image.src = result.url
    }),
  )
}

function cleanExportDom(container: HTMLElement): void {
  DOMPurify.sanitize(container, {
    IN_PLACE: true,
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['srcdoc'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto):|data:image\/(?:png|jpeg|gif|webp|svg\+xml);|(?:\.{0,2}\/|#|[^:/?#]+(?:[/?#]|$)))/i,
  })
}

export async function buildStandaloneHtml(options: BuildStandaloneHtmlOptions): Promise<string> {
  const renderer = createMarkdownRenderer()
  const container = document.createElement('article')
  container.className = 'openmd-document'
  container.appendChild(sanitizedFragment(renderer.render(options.markdown)))

  await renderMermaidDiagrams(container)
  await applyImageStrategy(container, options)
  cleanExportDom(container)

  const createdAt = (options.createdAt ?? new Date()).toISOString()
  const title = escapeHtml(options.title.trim() || 'OpenMD 文档')
  const bodyHtml = container.innerHTML
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="OpenMD">
  <meta name="created" content="${createdAt}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https: http:; style-src 'unsafe-inline'; font-src data:">
  <title>${title}</title>
  <style>${STANDALONE_KATEX_CSS}\n${highlightCss}\n${EXPORT_STYLES}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}
