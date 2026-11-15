import { describe, expect, it, vi } from 'vitest'
import { AutoReceiver, MAX_RECEIVES_PER_TICK } from './auto-receiver'
import type { AutoReceiveTarget, PendingReceive } from './auto-receiver'

function setup(pending: Record<string, string[]>, failing: Set<string> = new Set()) {
  const received: string[] = []
  let clock = 0
  const targets: AutoReceiveTarget[] = Object.keys(pending).map((address) => ({
    address,
    receive: vi.fn(async (hash: string) => {
      if (failing.has(hash)) throw new Error('publish failed')
      received.push(hash)
      pending[address] = pending[address].filter((h) => h !== hash)
    }),
  }))
  const onReceived = vi.fn()
  const receiver = new AutoReceiver({
    targets: async () => targets,
    listUnreceived: async (address) =>
      pending[address].map((hash): PendingReceive => ({ hash })),
    onReceived,
    now: () => clock,
  })
  return { receiver, received, targets, onReceived, advance: (ms: number) => (clock += ms) }
}

describe('AutoReceiver', () => {
  it('receives every pending block of every account, in order', async () => {
    const { receiver, received, onReceived } = setup({ a: ['a1', 'a2'], b: ['b1'] })

    expect(await receiver.tick()).toEqual(['a1', 'a2', 'b1'])
    expect(received).toEqual(['a1', 'a2', 'b1'])
    expect(onReceived).toHaveBeenCalledWith('b', { hash: 'b1' })
  })

  it('does nothing without targets', async () => {
    const receiver = new AutoReceiver({ targets: async () => [], listUnreceived: vi.fn() })
    expect(await receiver.tick()).toEqual([])
  })

  it('caps the receives per tick', async () => {
    const many = Array.from({ length: MAX_RECEIVES_PER_TICK + 5 }, (_, i) => `h${i}`)
    const { receiver } = setup({ a: many })

    expect(await receiver.tick()).toHaveLength(MAX_RECEIVES_PER_TICK)
    expect(await receiver.tick()).toHaveLength(5)
  })

  it('backs off a failing block and stops that account for the tick', async () => {
    const failing = new Set(['a1'])
    const { receiver, targets, advance } = setup({ a: ['a1', 'a2'], b: ['b1'] }, failing)

    // a1 fails: a2 waits for the next tick, b still gets its turn.
    expect(await receiver.tick()).toEqual(['b1'])
    // a1 is backing off, so a2 goes through.
    expect(await receiver.tick()).toEqual(['a2'])
    expect(targets[0].receive).toHaveBeenCalledTimes(2)

    // Still backing off: a1 is not retried.
    advance(10_000)
    await receiver.tick()
    expect(targets[0].receive).toHaveBeenCalledTimes(2)

    // After the backoff it is retried and succeeds.
    failing.clear()
    advance(30_000)
    expect(await receiver.tick()).toEqual(['a1'])
  })

  it('keeps going when listing one account fails', async () => {
    const receiver = new AutoReceiver({
      targets: async () => [
        { address: 'a', receive: vi.fn() },
        { address: 'b', receive: vi.fn(async () => {}) },
      ],
      listUnreceived: async (address) => {
        if (address === 'a') throw new Error('node down')
        return [{ hash: 'b1' }]
      },
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await receiver.tick()).toEqual(['b1'])
  })

  it('never runs two ticks at once', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const receive = vi.fn(async () => gate)
    const receiver = new AutoReceiver({
      targets: async () => [{ address: 'a', receive }],
      listUnreceived: async () => [{ hash: 'a1' }],
    })

    const first = receiver.tick()
    expect(await receiver.tick()).toEqual([])
    release()
    expect(await first).toEqual(['a1'])
    expect(receive).toHaveBeenCalledTimes(1)
  })
})
