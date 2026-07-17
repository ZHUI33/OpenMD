import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language'
import { codeBlockConfig, type CodeBlockConfig } from '@milkdown/kit/component/code-block'
import type { Ctx } from '@milkdown/kit/ctx'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import DOMPurify from 'dompurify'
import type mermaid from 'mermaid'
import type { MermaidConfig, RenderResult } from 'mermaid'

export const MERMAID_LANGUAGE = 'mermaid'
export const MERMAID_RENDER_DEBOUNCE_MS = 320

const MERMAID_PREVIEW_CLASS = 'openmd-mermaid-preview'
const MERMAID_PREVIEW_TOKEN_ATTRIBUTE = 'data-openmd-mermaid-token'
const MERMAID_RENDER_HOST_ATTRIBUTE = 'data-openmd-mermaid-render-host'
const MERMAID_EDITING_ATTRIBUTE = 'data-openmd-mermaid-editing'
const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const BLOCKED_SVG_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
]

/**
 * Configuration is intentionally locked against Mermaid frontmatter/directives.
 * SVG output is sanitized again before it reaches the preview NodeView.
 */
export const OPENMD_MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  htmlLabels: false,
  theme: 'neutral',
  maxTextSize: 100_000,
  maxEdges: 1_000,
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'suppressErrorRendering',
    'htmlLabels',
    'maxTextSize',
    'maxEdges',
    'dompurifyConfig',
    'fontFamily',
    'altFontFamily',
    'themeCSS',
    'themeVariables',
    'theme',
    'fontSize',
  ],
  dompurifyConfig: {
    USE_PROFILES: { svg: true, svgFilters: true, html: false },
    FORBID_TAGS: BLOCKED_SVG_TAGS,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i,
  },
}

export interface MermaidRenderEngine {
  initialize(config: MermaidConfig): void
  render(id: string, source: string, container: Element): Promise<Pick<RenderResult, 'svg'>>
}

export interface OpenMdMermaidFeatureOptions {
  engine?: MermaidRenderEngine
  debounceMs?: number
}

type MermaidModule = { default: typeof mermaid }

let mermaidModulePromise: Promise<MermaidModule> | undefined

class LazyMermaidEngine implements MermaidRenderEngine {
  private config?: MermaidConfig

  initialize(config: MermaidConfig): void {
    this.config = config
  }

  async render(id: string, source: string, container: Element): Promise<Pick<RenderResult, 'svg'>> {
    mermaidModulePromise ??= import('mermaid')
    const { default: engine } = await mermaidModulePromise
    if (this.config) engine.initialize(this.config)
    return engine.render(id, source, container)
  }
}

interface PreviewJob {
  applyPreview: (value: null | string | HTMLElement) => void
  ownerDocument: Document
  source: string
  timer: number | null
  token: string
}

const mermaidPlaintextParser: StreamParser<null> = {
  name: MERMAID_LANGUAGE,
  startState: () => null,
  token: (stream) => {
    stream.skipToEnd()
    return null
  },
}

/** Mermaid remains standard fenced code; this only adds it to the language picker. */
export const openMdMermaidLanguage = LanguageDescription.of({
  name: MERMAID_LANGUAGE,
  alias: ['mmd'],
  extensions: ['mmd', 'mermaid'],
  support: new LanguageSupport(StreamLanguage.define(mermaidPlaintextParser)),
})

let previewSequence = 0
let renderSequence = 0

function nextUniqueSuffix(): string {
  const randomPart = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
  if (randomPart) return randomPart
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createMermaidPreviewToken(): string {
  previewSequence += 1
  return `openmd-mermaid-preview-${previewSequence.toString(36)}-${nextUniqueSuffix()}`
}

export function createMermaidRenderId(): string {
  renderSequence += 1
  return `openmd-mermaid-svg-${renderSequence.toString(36)}-${nextUniqueSuffix()}`
}

export function isMermaidLanguage(language: unknown): boolean {
  return typeof language === 'string' && language.trim().toLowerCase() === MERMAID_LANGUAGE
}

export function isSafeMermaidLink(value: string): boolean {
  const candidate = value.trim()
  if (/^#[A-Za-z_][\w:.-]*$/.test(candidate)) return true
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(candidate).protocol)
  } catch {
    return false
  }
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|([^\r\n\f0-9a-f]))/gi,
    (_match, hexadecimal: string | undefined, escaped: string | undefined) => {
      if (hexadecimal) {
        const codePoint = Number.parseInt(hexadecimal, 16)
        if (codePoint === 0 || codePoint > 0x10ffff) return '\uFFFD'
        return String.fromCodePoint(codePoint)
      }
      return escaped ?? ''
    },
  )
}

function securityNormalizedSource(source: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutLineContinuations = withoutComments.replace(/\\(?:\r\n|[\n\r\f])/g, '')
  return decodeCssEscapes(withoutLineContinuations)
}

function rejectUnsafeMermaidSource(reason: string): never {
  throw new Error(`Mermaid 安全策略拒绝渲染：${reason}。源码未被修改，仍可继续编辑。`)
}

/**
 * Mermaid builds diagram CSS while its temporary SVG is connected to the live
 * document. Reject network-capable syntax before Mermaid parses or touches the
 * DOM; the original source remains untouched in the editor document.
 */
export function validateMermaidSourceSafety(source: string): void {
  if (/^\uFEFF?[\t ]*(?:\r?\n[\t ]*)*---[\t ]*(?:\r?\n|$)/.test(source)) {
    rejectUnsafeMermaidSource('不支持 Mermaid frontmatter 配置')
  }

  if (/%%\s*\{\s*(?:init|config)\s*:/i.test(source)) {
    rejectUnsafeMermaidSource('不支持 init/config 指令')
  }

  const normalized = securityNormalizedSource(source)

  if (/(?:^|[\r\n;])\s*click\b/im.test(normalized)) {
    rejectUnsafeMermaidSource('不支持可交互链接或回调指令')
  }

  if (
    /<\s*(?:img|image|a)\b/i.test(normalized) ||
    /!\[[^\]\r\n]*\]\s*\(/.test(normalized) ||
    /(?:@\{|,)\s*(?:img|image)\s*:/i.test(normalized) ||
    /\bshape\s*:\s*["']?(?:img|image)\b/i.test(normalized)
  ) {
    rejectUnsafeMermaidSource('不支持外部图片或 HTML 链接')
  }

  if (
    /\burl\s*\(/i.test(normalized) ||
    /@import\b/i.test(normalized) ||
    /(?:-webkit-)?image-set\s*\(/i.test(normalized) ||
    /\bcross-fade\s*\(/i.test(normalized) ||
    /@font-face\b/i.test(normalized)
  ) {
    rejectUnsafeMermaidSource('样式中包含可加载外部资源的语法')
  }

  if (
    /(?:^|[^A-Za-z0-9+.-])(?:https?|ftp|file|data|javascript|vbscript|blob|mailto|tel):/i.test(
      normalized,
    ) ||
    /(?:^|[\s"'(=:[{,])\/\/[A-Za-z0-9]/m.test(normalized)
  ) {
    rejectUnsafeMermaidSource('不支持外部或危险 URI')
  }
}

function cssContainsUnsafeReference(value: string): boolean {
  if (/(?:@import|expression\s*\(|(?:java|vb)script\s*:|data\s*:|-moz-binding)/i.test(value)) {
    return true
  }

  const urls = value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)
  for (const match of urls) {
    if (!/^#[A-Za-z_][\w:.-]*$/.test(match[2]?.trim() ?? '')) return true
  }
  return false
}

function hardenSanitizedSvg(svg: SVGElement): void {
  const elements = [svg, ...svg.querySelectorAll('*')]
  for (const element of elements) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attribute.name)
        continue
      }

      if (name === 'href' || name === 'xlink:href' || name === 'src') {
        const isAnchor = element.localName.toLowerCase() === 'a'
        const isLocalReference = /^#[A-Za-z_][\w:.-]*$/.test(attribute.value.trim())
        if (!(isLocalReference || (isAnchor && isSafeMermaidLink(attribute.value)))) {
          element.removeAttribute(attribute.name)
        }
        continue
      }

      if (
        name === 'xml:base' ||
        (attribute.value.toLowerCase().includes('url(') &&
          cssContainsUnsafeReference(attribute.value)) ||
        (name === 'style' && cssContainsUnsafeReference(attribute.value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }

  svg.querySelectorAll('style').forEach((style) => {
    if (cssContainsUnsafeReference(style.textContent ?? '')) style.remove()
  })

  svg.querySelectorAll('a[href], a[xlink\\:href]').forEach((anchor) => {
    anchor.setAttribute('target', '_blank')
    anchor.setAttribute('rel', 'noopener noreferrer')
  })
}

function createPreviewShell(ownerDocument: Document, token: string, state: string): HTMLDivElement {
  const shell = ownerDocument.createElement('div')
  shell.id = token
  shell.className = `${MERMAID_PREVIEW_CLASS} openmd-mermaid-${state}`
  shell.dataset.openmdMermaidToken = token
  shell.style.maxWidth = '100%'
  shell.style.overflowX = 'auto'
  shell.style.borderRadius = '8px'
  shell.style.background = 'var(--openmd-mermaid-background, #fff)'
  shell.style.color = 'var(--openmd-mermaid-foreground, #202124)'
  return shell
}

function createMermaidRenderHost(ownerDocument: Document, renderId: string): HTMLDivElement {
  const host = ownerDocument.createElement('div')
  host.setAttribute(MERMAID_RENDER_HOST_ATTRIBUTE, renderId)
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '1200px'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  ownerDocument.body.appendChild(host)
  return host
}

/**
 * Converts Mermaid's SVG string into a sanitized DOM subtree. No unsanitized
 * string is assigned through innerHTML by OpenMD.
 */
export function sanitizeMermaidSvg(
  dirtySvg: string,
  ownerDocument: Document = document,
  token = createMermaidPreviewToken(),
): HTMLDivElement {
  const sanitized = DOMPurify.sanitize(dirtySvg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: false },
    FORBID_TAGS: BLOCKED_SVG_TAGS,
    ADD_ATTR: ['xmlns', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#)/i,
    RETURN_DOM_FRAGMENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as unknown as DocumentFragment
  const sanitizedSvg = sanitized.querySelector('svg')
  if (!(sanitizedSvg instanceof SVGElement)) {
    throw new Error('Mermaid 没有生成有效的 SVG。')
  }

  const importedSvg = ownerDocument.importNode(sanitizedSvg, true) as SVGElement
  hardenSanitizedSvg(importedSvg)
  importedSvg.setAttribute('role', 'img')
  if (!importedSvg.hasAttribute('aria-label') && !importedSvg.hasAttribute('aria-labelledby')) {
    importedSvg.setAttribute('aria-label', 'Mermaid 图表')
  }
  importedSvg.style.display = 'block'
  importedSvg.style.width = 'auto'
  importedSvg.style.maxWidth = '100%'
  importedSvg.style.margin = '0 auto'

  const preview = createPreviewShell(ownerDocument, token, 'diagram')
  preview.appendChild(importedSvg)
  return preview
}

function readableRenderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').trim().slice(0, 1_500) || '未知 Mermaid 语法错误。'
}

function createLoadingPreview(ownerDocument: Document, token: string): HTMLDivElement {
  const loading = createPreviewShell(ownerDocument, token, 'loading')
  loading.setAttribute('role', 'status')
  loading.setAttribute('aria-live', 'polite')
  loading.style.padding = '16px'
  loading.textContent = '正在渲染 Mermaid 图表…'
  return loading
}

function createErrorPreview(
  ownerDocument: Document,
  token: string,
  error: unknown,
): HTMLDivElement {
  const failure = createPreviewShell(ownerDocument, token, 'error')
  failure.setAttribute('role', 'alert')
  failure.style.padding = '14px 16px'
  failure.style.whiteSpace = 'pre-wrap'
  failure.textContent = `Mermaid 图表无法渲染：${readableRenderError(error)}`
  return failure
}

function cloneMermaidConfig(): MermaidConfig {
  return {
    ...OPENMD_MERMAID_CONFIG,
    secure: [...(OPENMD_MERMAID_CONFIG.secure ?? [])],
    dompurifyConfig: { ...OPENMD_MERMAID_CONFIG.dompurifyConfig },
  }
}

export class MermaidPreviewController {
  private readonly debounceMs: number
  private readonly engine: MermaidRenderEngine
  private readonly jobs = new Map<string, PreviewJob>()
  private readonly jobsByApplyPreview = new Map<PreviewJob['applyPreview'], PreviewJob>()
  private readonly renderHosts = new Set<HTMLElement>()
  private root?: HTMLElement
  private destroyed = false
  private initialized = false

  constructor({
    engine = new LazyMermaidEngine(),
    debounceMs = MERMAID_RENDER_DEBOUNCE_MS,
  }: OpenMdMermaidFeatureOptions = {}) {
    this.engine = engine
    this.debounceMs = Math.max(0, debounceMs)
  }

  attach(root: HTMLElement): void {
    this.root = root
    // Milkdown may replace its ProseMirror view while applying the initial
    // document. A fresh attachment starts a new editor-local lifecycle.
    this.destroyed = false
  }

  detach(root: HTMLElement): boolean {
    if (this.root !== root) return false
    this.root = undefined
    // ProseMirror can synchronously replace a view. Delay final cleanup one
    // microtask so a replacement PluginView can attach without losing the
    // preview jobs its NodeViews just scheduled.
    queueMicrotask(() => {
      if (!this.root) this.destroy()
    })
    return true
  }

  createPreview(
    source: string,
    applyPreview: (value: null | string | HTMLElement) => void,
    ownerDocument: Document = this.root?.ownerDocument ?? document,
  ): HTMLElement {
    const previousJob = this.jobsByApplyPreview.get(applyPreview)
    if (previousJob) {
      if (previousJob.timer !== null) {
        previousJob.ownerDocument.defaultView?.clearTimeout(previousJob.timer)
        previousJob.timer = null
      }
      this.jobs.delete(previousJob.token)
    }

    const token = createMermaidPreviewToken()
    const preview = createLoadingPreview(ownerDocument, token)
    // During a Milkdown view replacement, NodeViews are constructed before
    // the new PluginView calls `attach`. A preview request therefore also
    // marks the beginning of the replacement lifecycle.
    this.destroyed = false

    const job: PreviewJob = {
      applyPreview,
      ownerDocument,
      source,
      timer: null,
      token,
    }
    job.timer =
      ownerDocument.defaultView?.setTimeout(() => void this.render(job), this.debounceMs) ?? null
    this.jobs.set(token, job)
    this.jobsByApplyPreview.set(applyPreview, job)
    return preview
  }

  destroy(): void {
    this.destroyed = true
    this.root = undefined
    for (const job of this.jobs.values()) {
      if (job.timer !== null) job.ownerDocument.defaultView?.clearTimeout(job.timer)
    }
    this.jobs.clear()
    this.jobsByApplyPreview.clear()
    for (const host of this.renderHosts) host.remove()
    this.renderHosts.clear()
  }

  private isCurrent(job: PreviewJob): boolean {
    if (this.destroyed || this.jobs.get(job.token) !== job) return false
    const current = job.ownerDocument.getElementById(job.token)
    if (!current || current.getAttribute(MERMAID_PREVIEW_TOKEN_ATTRIBUTE) !== job.token) {
      return false
    }
    return !this.root || this.root.contains(current)
  }

  private forgetJob(job: PreviewJob): void {
    this.jobs.delete(job.token)
    if (this.jobsByApplyPreview.get(job.applyPreview) === job) {
      this.jobsByApplyPreview.delete(job.applyPreview)
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    this.engine.initialize(cloneMermaidConfig())
    this.initialized = true
  }

  private async render(job: PreviewJob): Promise<void> {
    job.timer = null
    if (!this.isCurrent(job)) {
      this.forgetJob(job)
      return
    }

    const renderId = createMermaidRenderId()
    let renderHost: HTMLElement | undefined
    try {
      validateMermaidSourceSafety(job.source)
      this.ensureInitialized()
      renderHost = createMermaidRenderHost(job.ownerDocument, renderId)
      this.renderHosts.add(renderHost)
      const { svg } = await this.engine.render(renderId, job.source, renderHost)
      if (!this.isCurrent(job)) return
      const preview = sanitizeMermaidSvg(svg, job.ownerDocument, job.token)
      if (!this.isCurrent(job)) return
      job.applyPreview(preview)
    } catch (error: unknown) {
      if (!this.isCurrent(job)) return
      job.applyPreview(createErrorPreview(job.ownerDocument, job.token, error))
    } finally {
      this.forgetJob(job)
      if (renderHost) {
        this.renderHosts.delete(renderHost)
        renderHost.remove()
      }
      // Mermaid can create this temporary error container before rejecting.
      job.ownerDocument.getElementById(`d${renderId}`)?.remove()
    }
  }
}

export function extendCodeBlockConfigWithMermaid(
  current: CodeBlockConfig,
  controller: MermaidPreviewController,
): CodeBlockConfig {
  const languages = current.languages.some(({ name }) => isMermaidLanguage(name))
    ? [...current.languages]
    : [...current.languages, openMdMermaidLanguage]
  const renderPreview = current.renderPreview
  const renderLanguage = current.renderLanguage

  return {
    ...current,
    languages,
    previewLabel: '预览',
    previewToggleButton: (previewOnlyMode) => (previewOnlyMode ? '编辑源码' : '隐藏源码'),
    renderLanguage: (language, selected) =>
      isMermaidLanguage(language) ? 'Mermaid' : renderLanguage(language, selected),
    renderPreview: (language, content, applyPreview) => {
      if (!isMermaidLanguage(language)) return renderPreview(language, content, applyPreview)
      return controller.createPreview(content, applyPreview)
    },
  }
}

function mermaidBlockFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const preview = target.closest<HTMLElement>(`.${MERMAID_PREVIEW_CLASS}`)
  return preview?.closest<HTMLElement>('.milkdown-code-block') ?? null
}

function syncMermaidPreviewMode(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(`.${MERMAID_PREVIEW_CLASS}`).forEach((preview) => {
    const block = preview.closest<HTMLElement>('.milkdown-code-block')
    if (!block || block.hasAttribute(MERMAID_EDITING_ATTRIBUTE)) return
    const editorHost = block.querySelector<HTMLElement>('.codemirror-host')
    const toggle = block.querySelector<HTMLButtonElement>('.preview-toggle-button')
    if (!editorHost || !toggle || editorHost.classList.contains('hidden')) return
    toggle.click()
  })
}

function enterMermaidSource(view: EditorView, event: Event): boolean {
  if (!view.editable) return false
  const block = mermaidBlockFromTarget(event.target)
  const editorHost = block?.querySelector<HTMLElement>('.codemirror-host')
  const toggle = block?.querySelector<HTMLButtonElement>('.preview-toggle-button')
  if (!block || !editorHost?.classList.contains('hidden') || !toggle) return false

  event.preventDefault()
  block.setAttribute(MERMAID_EDITING_ATTRIBUTE, 'true')
  toggle.click()
  block.ownerDocument.defaultView?.requestAnimationFrame?.(() => {
    block.querySelector<HTMLElement>('.cm-content')?.focus()
  })
  return true
}

function handleMermaidClick(view: EditorView, event: Event): boolean {
  if (enterMermaidSource(view, event)) return true
  const target = event.target
  if (!(target instanceof Element)) return false
  const toggle = target.closest<HTMLElement>('.preview-toggle-button')
  const block = toggle?.closest<HTMLElement>('.milkdown-code-block')
  if (!block?.querySelector(`.${MERMAID_PREVIEW_CLASS}`)) return false
  const currentEditorHost = block.querySelector<HTMLElement>('.codemirror-host')
  if (currentEditorHost?.classList.contains('hidden')) {
    block.setAttribute(MERMAID_EDITING_ATTRIBUTE, 'true')
  }

  queueMicrotask(() => {
    const editorHost = block.querySelector<HTMLElement>('.codemirror-host')
    block.toggleAttribute(MERMAID_EDITING_ATTRIBUTE, !editorHost?.classList.contains('hidden'))
  })
  return false
}

function returnToMermaidPreview(view: EditorView, event: FocusEvent): boolean {
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.cm-editor')) return false
  const block = target.closest<HTMLElement>('.milkdown-code-block')
  if (!block?.querySelector(`.${MERMAID_PREVIEW_CLASS}`)) return false
  const nextTarget = event.relatedTarget
  if (nextTarget instanceof Node && block.contains(nextTarget)) return false

  queueMicrotask(() => {
    if (!view.dom.isConnected) return
    const activeElement = view.root.activeElement
    if (activeElement && block.contains(activeElement)) return
    const editorHost = block.querySelector<HTMLElement>('.codemirror-host')
    if (!editorHost?.classList.contains('hidden')) {
      block.querySelector<HTMLButtonElement>('.preview-toggle-button')?.click()
    }
    block.removeAttribute(MERMAID_EDITING_ATTRIBUTE)
  })
  return false
}

const mermaidInteractionKey = new PluginKey('openmd-mermaid-interaction')

/**
 * Builds an editor-local Mermaid feature. Create one instance per Crepe editor.
 * Configure it after OpenMD's base code-block configuration.
 */
export function createOpenMdMermaidFeature(options: OpenMdMermaidFeatureOptions = {}) {
  const controller = new MermaidPreviewController(options)
  const interactionPlugin = $prose(
    () =>
      new Plugin({
        key: mermaidInteractionKey,
        props: {
          handleDOMEvents: {
            click: handleMermaidClick,
            dblclick: enterMermaidSource,
            focusout: returnToMermaidPreview,
          },
        },
        view: (view) => {
          controller.attach(view.dom)
          let destroyed = false
          let syncQueued = false
          const scheduleSync = (): void => {
            if (destroyed || syncQueued) return
            syncQueued = true
            queueMicrotask(() => {
              syncQueued = false
              if (!destroyed) syncMermaidPreviewMode(view.dom)
            })
          }
          const MutationObserverConstructor = view.dom.ownerDocument.defaultView?.MutationObserver
          const observer = MutationObserverConstructor
            ? new MutationObserverConstructor(scheduleSync)
            : undefined
          observer?.observe(view.dom, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true,
          })
          scheduleSync()
          return {
            update: scheduleSync,
            destroy: () => {
              destroyed = true
              observer?.disconnect()
              view.dom
                .querySelectorAll<HTMLElement>(`[${MERMAID_EDITING_ATTRIBUTE}]`)
                .forEach((block) => block.removeAttribute(MERMAID_EDITING_ATTRIBUTE))
              controller.detach(view.dom)
            },
          }
        },
      }),
  )

  return {
    configureCodeBlocks: (ctx: Ctx): void => {
      ctx.update(codeBlockConfig.key, (current) =>
        extendCodeBlockConfigWithMermaid(current, controller),
      )
    },
    plugins: [interactionPlugin],
  }
}
