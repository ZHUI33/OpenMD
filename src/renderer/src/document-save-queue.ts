/** Serializes writes per document while allowing different documents to save in parallel. */
export class DocumentSaveQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<Result>(documentId: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(documentId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.tails.set(documentId, current)

    void current.then(
      () => {
        if (this.tails.get(documentId) === current) this.tails.delete(documentId)
      },
      () => {
        if (this.tails.get(documentId) === current) this.tails.delete(documentId)
      },
    )
    return current
  }

  isSaving(documentId: string): boolean {
    return this.tails.has(documentId)
  }

  async whenIdle(documentId?: string): Promise<void> {
    if (documentId) {
      while (this.tails.has(documentId)) {
        const tail = this.tails.get(documentId)!
        await tail.catch(() => undefined)
        if (this.tails.get(documentId) === tail) this.tails.delete(documentId)
      }
      return
    }
    while (this.tails.size > 0) {
      const tails = [...this.tails.values()]
      await Promise.all(tails.map((task) => task.catch(() => undefined)))
      for (const [id, tail] of this.tails) {
        if (tails.includes(tail)) this.tails.delete(id)
      }
    }
  }
}
