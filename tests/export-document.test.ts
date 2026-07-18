// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import { buildStandaloneHtml } from '../src/renderer/src/export-document'

describe('standalone HTML export', () => {
  it('renders rich Markdown, embeds local images, and strips executable HTML', async () => {
    const resolveImage = vi.fn(async () => ({
      ok: true,
      url: 'data:image/png;base64,cG5n',
    }))
    const html = await buildStandaloneHtml({
      markdown: [
        '# Export title',
        '',
        '<script>alert(1)</script>',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '```js',
        'const answer = 42',
        '```',
        '',
        '$x^2$',
        '',
        '![diagram](assets/diagram.png)',
      ].join('\n'),
      title: 'Safe export',
      documentPath: 'C:\\docs\\example.md',
      imageStrategy: 'base64',
      imagesApi: { resolveImage },
      createdAt: new Date('2026-07-18T00:00:00.000Z'),
    })

    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<table>')
    expect(html).toContain('hljs')
    expect(html).toContain('katex')
    expect(html).not.toContain('@font-face')
    expect(html).not.toMatch(/url\(/iu)
    expect(html).toContain('data:image/png;base64,cG5n')
    expect(html).not.toMatch(/<script\b/iu)
    expect(html).not.toContain('ipcRenderer')
    expect(resolveImage).toHaveBeenCalledWith({
      documentPath: 'C:\\docs\\example.md',
      source: 'assets/diagram.png',
    })
  })

  it('preserves relative image references when requested', async () => {
    const resolveImage = vi.fn()
    const html = await buildStandaloneHtml({
      markdown: '![local](./images/local.png)',
      title: 'Relative resources',
      documentPath: '/tmp/example.md',
      imageStrategy: 'relative',
      imagesApi: { resolveImage },
    })

    expect(html).toContain('src="./images/local.png"')
    expect(resolveImage).not.toHaveBeenCalled()
  })
})
