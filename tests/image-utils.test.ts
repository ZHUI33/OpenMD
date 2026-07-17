import { describe, expect, it } from 'vitest'

import { encodeMarkdownPath, serializeMarkdownImage } from '../src/shared/image-utils'

describe('image Markdown utilities', () => {
  it('serializes a standard Markdown image without private syntax', () => {
    expect(serializeMarkdownImage('图片说明', 'article.assets/architecture.png')).toBe(
      '![图片说明](article.assets/architecture.png)',
    )
  })

  it('escapes alt text and URI-sensitive destination characters', () => {
    expect(serializeMarkdownImage('diagram [draft]', 'article.assets/diagram (1).png')).toBe(
      '![diagram \\[draft\\]](article.assets/diagram%20%281%29.png)',
    )
  })

  it('uses forward slashes and URI encoding for Markdown paths', () => {
    expect(encodeMarkdownPath('article.assets\\架构 图 (1).png')).toBe(
      'article.assets/%E6%9E%B6%E6%9E%84%20%E5%9B%BE%20%281%29.png',
    )
  })
})
