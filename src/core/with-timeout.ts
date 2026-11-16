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
      // Count real elapsed time (background tabs throttle timers to as little
      // as once a minute), and only for intervals that started unpaused.
      let left = ms
      let last = Date.now()
      let wasPaused = paused()
      const wait = () => {
        timer = setTimeout(() => {
          const now = Date.now()
          if (!wasPaused) left -= now - last
          last = now
          wasPaused = paused()
          if (left <= 0) reject(new Error(message))
          else wait()
        }, Math.min(PAUSE_TICK_MS, Math.max(left, 0)))
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
