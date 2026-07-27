import { describe, expect, it } from 'vitest'

import { reconcileSerializedMarkdown } from '../src/renderer/src/editor/source-fidelity'

describe('source-preserving visual serialization', () => {
  it('patches a changed paragraph without rewriting YAML, fences, HTML, or CRLF', () => {
    const source = [
      '---',
      'title: "原样"',
      '---',
      '',
      'Before text.',
      '',
      '~~~ts',
      'const value = 1',
      '~~~',
      '',
      '<section onclick="never()">raw</section>',
      '',
    ].join('\r\n')
    const previousSerialized = [
      '---',
      'title: "原样"',
      '---',
      '',
      'Before text.',
      '',
      '```ts',
      'const value = 1',
      '```',
      '',
      '<section onclick="never()">raw</section>',
      '',
    ].join('\n')
    const nextSerialized = previousSerialized.replace('Before text.', 'After text.')

    const result = reconcileSerializedMarkdown(source, previousSerialized, nextSerialized)

    expect(result.markdown).toContain('After text.\r\n')
    expect(result.markdown).toContain('title: "原样"\r\n')
    expect(result.markdown).toContain('~~~ts\r\nconst value = 1\r\n~~~')
    expect(result.markdown).toContain('<section onclick="never()">raw</section>\r\n')
  })

  it('uses the local line ending for inserted visual content in a mixed document', () => {
    const source = '第一段\r\n\r\nSecond\n\nThird\r\n'
    const previousSerialized = '第一段\n\nSecond\n\nThird\n'
    const nextSerialized = '第一段\n\nSecond plus\n\nThird\n'

    expect(reconcileSerializedMarkdown(source, previousSerialized, nextSerialized).markdown).toBe(
      '第一段\r\n\r\nSecond plus\n\nThird\r\n',
    )
  })

  it('preserves alternative list and emphasis markers outside the edit', () => {
    const source = '* item\n\n__strong__\n\nTarget'
    const previousSerialized = '- item\n\n**strong**\n\nTarget\n'
    const nextSerialized = '- item\n\n**strong**\n\nChanged\n'

    expect(reconcileSerializedMarkdown(source, previousSerialized, nextSerialized).markdown).toBe(
      '* item\n\n__strong__\n\nChanged',
    )
  })

  it('returns the exact source when the visual document did not change', () => {
    const source = 'mixed\r\nline\nendings\r'
    expect(
      reconcileSerializedMarkdown(source, 'mixed\nline\nendings\n', 'mixed\nline\nendings\n'),
    ).toEqual({
      markdown: source,
      changed: false,
    })
  })
})
