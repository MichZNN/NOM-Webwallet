import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './with-timeout'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('rejects once the time is up, or settles as the promise does', async () => {
    const late = withTimeout(new Promise(() => {}), 5000, 'too slow')
    const check = expect(late).rejects.toThrow('too slow')
    await vi.advanceTimersByTimeAsync(5000)
    await check
    await expect(withTimeout(Promise.resolve(1), 5000, 'x')).resolves.toBe(1)
  })

  it('does not count time while paused', async () => {
    let paused = false
    let settled = false
    const p = withTimeout(new Promise(() => {}), 5000, 'too slow', () => paused)
    p.catch(() => (settled = true))

    await vi.advanceTimersByTimeAsync(2000) // 2 s counted
    paused = true
    await vi.advanceTimersByTimeAsync(60_000) // proof-of-work: not counted
    paused = false
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).rejects.toThrow('too slow')
  })
})
