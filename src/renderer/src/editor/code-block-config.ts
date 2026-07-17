import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  type StreamParser,
} from '@codemirror/language'
import { languages as codeMirrorLanguages } from '@codemirror/language-data'
import { codeBlockConfig } from '@milkdown/kit/component/code-block'
import type { Ctx } from '@milkdown/kit/ctx'

export const OPENMD_CODE_LANGUAGE_IDS = [
  'plaintext',
  'mermaid',
  'javascript',
  'typescript',
  'java',
  'python',
  'sql',
  'json',
  'html',
  'css',
  'bash',
  'markdown',
] as const

export type OpenMdCodeLanguage = (typeof OPENMD_CODE_LANGUAGE_IDS)[number]

export const OPENMD_CODE_LANGUAGE_LABELS: Readonly<Record<OpenMdCodeLanguage, string>> = {
  plaintext: 'Plain Text',
  mermaid: 'Mermaid',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  python: 'Python',
  sql: 'SQL',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  bash: 'Bash',
  markdown: 'Markdown',
}

const SOURCE_LANGUAGE_NAMES: Readonly<
  Record<Exclude<OpenMdCodeLanguage, 'plaintext' | 'mermaid'>, string>
> = {
  javascript: 'javascript',
  typescript: 'typescript',
  java: 'java',
  python: 'python',
  sql: 'sql',
  json: 'json',
  html: 'html',
  css: 'css',
  bash: 'bash',
  markdown: 'markdown',
}

const plaintextParser: StreamParser<null> = {
  name: 'plaintext',
  startState: () => null,
  token: (stream) => {
    stream.skipToEnd()
    return null
  },
}

const plaintextLanguage = LanguageDescription.of({
  name: 'plaintext',
  alias: ['text', 'txt'],
  extensions: ['txt', 'text'],
  support: new LanguageSupport(StreamLanguage.define(plaintextParser)),
})

// Mermaid has no bundled CodeMirror grammar. It still needs a canonical
// language entry so users can select the standard fenced info string while
// editing the diagram source.
const mermaidLanguage = LanguageDescription.of({
  name: 'mermaid',
  alias: ['mermaid'],
  extensions: ['mmd', 'mermaid'],
  support: new LanguageSupport(StreamLanguage.define(plaintextParser)),
})

function sourceLanguage(name: string): LanguageDescription {
  const source = LanguageDescription.matchLanguageName(codeMirrorLanguages, name)
  if (!source) throw new Error(`CodeMirror language is unavailable: ${name}`)
  return source
}

function canonicalLanguage(
  id: Exclude<OpenMdCodeLanguage, 'plaintext' | 'mermaid'>,
): LanguageDescription {
  const source = sourceLanguage(SOURCE_LANGUAGE_NAMES[id])
  return LanguageDescription.of({
    name: id,
    alias: source.alias,
    extensions: source.extensions,
    filename: source.filename,
    load: () => source.load(),
  })
}

/**
 * The language name is deliberately the lowercase Markdown info string.
 * Crepe writes the selected LanguageDescription.name to the code-block node,
 * so keeping these canonical guarantees fences such as ```javascript.
 */
export const openMdCodeLanguages: readonly LanguageDescription[] = [
  plaintextLanguage,
  mermaidLanguage,
  ...OPENMD_CODE_LANGUAGE_IDS.filter(
    (id): id is Exclude<OpenMdCodeLanguage, 'plaintext' | 'mermaid'> =>
      id !== 'plaintext' && id !== 'mermaid',
  ).map(canonicalLanguage),
]

/**
 * Runs after Crepe's CodeMirror feature config and narrows its language picker
 * without replacing CodeMirror's built-in editing extensions or theme.
 */
export function configureOpenMdCodeBlocks(ctx: Ctx): void {
  ctx.update(codeBlockConfig.key, (config) => ({
    ...config,
    languages: [...openMdCodeLanguages],
    searchPlaceholder: '搜索语言',
    noResultText: '没有匹配的语言',
    copyText: '复制代码',
    previewOnlyByDefault: false,
    renderLanguage: (language) => {
      const id = language.toLowerCase() as OpenMdCodeLanguage
      return OPENMD_CODE_LANGUAGE_LABELS[id] ?? language
    },
  }))
}
