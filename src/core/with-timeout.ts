/** Granularity of a pausable timeout: how often it checks whether it is paused. */
const PAUSE_TICK_MS = 1000

/**
 * Settles as `promise` does, or rejects with `new Error(message)` once `ms` pass first.
 * With `paused`, time only counts while `paused()` is false (checked every second),
 * e.g. to leave proof-of-work out of a time limit meant for the node.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  paused?: () => boolean
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    if (paused) {
      let left = ms
      const wait = () => {
        const slice = Math.min(PAUSE_TICK_MS, left)
        timer = setTimeout(() => {
          if (!paused()) left -= slice
          if (left <= 0) reject(new Error(message))
          else wait()
        }, slice)
      }
      wait()
    } else {
      timer = setTimeout(() => reject(new Error(message)), ms)
    }
    // then(onValue, onError) leaves no derived promise without a rejection
    // handler, so a losing promise that rejects later is never unhandled.
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
