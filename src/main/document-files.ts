import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

export async function readUtf8Document(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8')
}

export async function writeUtf8Document(filePath: string, content: string): Promise<void> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )

  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export function withDefaultMarkdownExtension(filePath: string): string {
  const extension = extname(filePath)
  return extension && extension !== '.' ? filePath : `${filePath}.md`
}
