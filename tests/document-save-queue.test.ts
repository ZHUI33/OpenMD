import { describe, expect, it } from 'vitest'

import { DocumentSaveQueue } from '../src/renderer/src/document-save-queue'

describe('DocumentSaveQueue', () => {
  it('serializes writes for one document and lets later writes read the latest state', async () => {
    const queue = new DocumentSaveQueue()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queue.run('document-a', async () => {
      events.push('first:start')
      await firstGate
      events.push('first:end')
      return 'first'
    })
    const second = queue.run('document-a', async () => {
      events.push('second:start')
      return 'second'
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    expect(queue.isSaving('document-a')).toBe(true)
    releaseFirst()
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(events).toEqual(['first:start', 'first:end', 'second:start'])
    await queue.whenIdle('document-a')
    expect(queue.isSaving('document-a')).toBe(false)
  })

  it('continues the queue after a failed save', async () => {
    const queue = new DocumentSaveQueue()
    const failed = queue.run('document-a', async () => {
      throw new Error('disk full')
    })
    const recovered = queue.run('document-a', async () => 'saved')

    await expect(failed).rejects.toThrow('disk full')
    await expect(recovered).resolves.toBe('saved')
  })
})
