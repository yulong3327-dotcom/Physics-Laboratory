/** Deduplicate serial media work while keeping every caller's cancellation independent. */
export function createSharedVideoTaskQueue<T>() {
  type Entry = { controller: AbortController; result: Promise<T>; consumers: number; settled: boolean }
  const pending = new Map<string, Entry>()
  let queue = Promise.resolve()

  return (key: string, execute: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason)
    let entry = pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      const work = queue.then(async () => {
        controller.signal.throwIfAborted()
        const result = await execute(controller.signal)
        controller.signal.throwIfAborted()
        return result
      })
      const created: Entry = { controller, result: work, consumers: 0, settled: false }
      created.result = work.finally(() => {
        created.settled = true
        if (pending.get(key) === created) pending.delete(key)
      })
      // Absorb abandoned work failures and keep later keys runnable.
      queue = created.result.then(() => undefined, () => undefined)
      pending.set(key, created)
      entry = created
    }

    const shared = entry
    shared.consumers += 1
    return new Promise<T>((resolve, reject) => {
      let finished = false
      const release = () => {
        if (finished) return false
        finished = true
        signal?.removeEventListener('abort', abort)
        shared.consumers -= 1
        if (!shared.consumers && !shared.settled) {
          // A new caller must start fresh, even if the old worker is still stopping.
          if (pending.get(key) === shared) pending.delete(key)
          shared.controller.abort()
        }
        return true
      }
      const abort = () => { if (release()) reject(signal!.reason) }
      signal?.addEventListener('abort', abort, { once: true })
      shared.result.then(value => { if (release()) resolve(value) }, error => { if (release()) reject(error) })
      if (signal?.aborted) abort()
    })
  }
}
