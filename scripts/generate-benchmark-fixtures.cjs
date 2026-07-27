const { mkdir, stat, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')

const outputDirectory = resolve(process.argv[2] || 'benchmarks/fixtures')

function sizedDocument(targetBytes, heading, paragraphFactory) {
  const chunks = [`# ${heading}\n\n`]
  let bytes = Buffer.byteLength(chunks[0])
  let index = 1
  while (bytes < targetBytes) {
    const paragraph = `${paragraphFactory(index)}\n\n`
    chunks.push(paragraph)
    bytes += Buffer.byteLength(paragraph)
    index += 1
  }
  return chunks.join('')
}

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  const fixtures = {
    'document-1mb.md': sizedDocument(
      1 * 1024 * 1024,
      '1 MB mixed prose benchmark',
      (index) =>
        `## Section ${index}\n\nParagraph ${index} includes English words、中文字符、an [authorized link](https://example.com/${index}) and inline \`code_${index}\`.`,
    ),
    'document-5mb.md': sizedDocument(
      5 * 1024 * 1024,
      '5 MB mixed prose benchmark',
      (index) =>
        `## Chapter ${index}\n\nLarge document paragraph ${index}: OpenMD keeps Markdown source exact while editing 中文内容 and **formatted text** without reparsing unrelated tabs.`,
    ),
    'long-list.md': [
      '# Long list benchmark',
      '',
      ...Array.from(
        { length: 30_000 },
        (_, index) =>
          `${index % 7 === 0 ? '  ' : ''}- Item ${index + 1} with task-like prose and Unicode 内容 ${index + 1}`,
      ),
      '',
    ].join('\n'),
    'large-table.md': [
      '# Large table benchmark',
      '',
      `| ${Array.from({ length: 16 }, (_, index) => `Column ${index + 1}`).join(' | ')} |`,
      `| ${Array.from({ length: 16 }, () => '---').join(' | ')} |`,
      ...Array.from(
        { length: 1_000 },
        (_, row) =>
          `| ${Array.from({ length: 16 }, (_, column) => `R${row + 1}C${column + 1}`).join(' | ')} |`,
      ),
      '',
    ].join('\n'),
    'many-code-blocks.md': [
      '# Many code blocks benchmark',
      '',
      ...Array.from(
        { length: 1_200 },
        (_, index) =>
          `## Example ${index + 1}\n\n\`\`\`typescript\nexport const value${index + 1} = ${index + 1}\nconsole.log(value${index + 1})\n\`\`\`\n`,
      ),
    ].join('\n'),
    'many-mermaid.md': [
      '# Many Mermaid diagrams benchmark',
      '',
      ...Array.from(
        { length: 500 },
        (_, index) =>
          `## Diagram ${index + 1}\n\n\`\`\`mermaid\nflowchart LR\n  A${index}["Start ${index + 1}"] --> B${index}["Finish ${index + 1}"]\n\`\`\`\n`,
      ),
    ].join('\n'),
  }

  const manifest = {}
  for (const [name, content] of Object.entries(fixtures)) {
    const filePath = join(outputDirectory, name)
    await writeFile(filePath, content, 'utf8')
    const info = await stat(filePath)
    manifest[name] = { bytes: info.size }
  }
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: manifest }, null, 2)}\n`,
    'utf8',
  )
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
