export class ConcurrencyManager {
  private counts = new Map<string, number>()
  private queues = new Map<string, Array<{ resolve: () => void; rawReject: (reason: Error) => void; settled: boolean }>>()
  private defaultLimit: number

  constructor(defaultLimit = 5) {
    this.defaultLimit = defaultLimit
  }

  async acquire(key: string): Promise<void> {
    const limit = this.defaultLimit
    if (limit === Infinity) return
    const current = this.counts.get(key) ?? 0
    if (current < limit) {
      this.counts.set(key, current + 1)
      return
    }
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(key) ?? []
      const entry = {
        resolve: () => {
          if (entry.settled) return
          entry.settled = true
          resolve()
        },
        rawReject: reject,
        settled: false,
      }
      queue.push(entry)
      this.queues.set(key, queue)
    })
  }

  release(key: string): void {
    if (this.defaultLimit === Infinity) return
    const queue = this.queues.get(key)
    while (queue && queue.length > 0) {
      const next = queue.shift()
      if (next && !next.settled) {
        next.resolve()
        return
      }
    }
    const current = this.counts.get(key) ?? 0
    if (current > 0) this.counts.set(key, current - 1)
  }

  getCount(key: string): number {
    return this.counts.get(key) ?? 0
  }

  get limit(): number {
    return this.defaultLimit
  }

  clear(): void {
    for (const [, queue] of this.queues) {
      for (const entry of queue) {
        if (!entry.settled) {
          entry.settled = true
          entry.rawReject(new Error(`Concurrency queue cancelled`))
        }
      }
    }
    this.counts.clear()
    this.queues.clear()
  }
}
