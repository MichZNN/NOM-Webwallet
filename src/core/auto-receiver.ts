/**
 * Receives incoming transactions for every unlocked account, like Syrius'
 * auto-receive worker. Free of Vue and the SDK so it runs under unit tests;
 * useAutoReceive wires it to the wallet, the node and a timer.
 */

/** An incoming transaction waiting to be received. */
export interface PendingReceive {
  /** Hash of the send block to receive. */
  hash: string
  /** Display amount, already formatted with the token's decimals. */
  amount?: string
  symbol?: string
}

/** One account that may receive: its address and how to publish a receive block. */
export interface AutoReceiveTarget {
  address: string
  receive: (hash: string) => Promise<void>
}

export interface AutoReceiverDeps {
  /** Accounts to receive for: visible accounts of unlocked wallets. */
  targets: () => Promise<AutoReceiveTarget[]>
  /** Unreceived blocks of `address`, oldest first. */
  listUnreceived: (address: string) => Promise<PendingReceive[]>
  onReceived?: (address: string, tx: PendingReceive) => void
  now?: () => number
}

/** Cap per tick, so a long backlog doesn't hog the send queue (each receive may need PoW). */
export const MAX_RECEIVES_PER_TICK = 10
const BASE_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 10 * 60_000

export class AutoReceiver {
  private ticking = false
  private readonly failures = new Map<string, { count: number; retryAt: number }>()

  constructor(private readonly deps: AutoReceiverDeps) {}

  /**
   * Receive what is pending. Overlapping calls return at once instead of
   * receiving the same block twice. Returns the hashes received this tick.
   */
  async tick(): Promise<string[]> {
    if (this.ticking) return []
    this.ticking = true
    const received: string[] = []
    const now = this.deps.now ?? Date.now

    try {
      const targets = await this.deps.targets()
      for (const target of targets) {
        if (received.length >= MAX_RECEIVES_PER_TICK) break

        let pending: PendingReceive[]
        try {
          pending = await this.deps.listUnreceived(target.address)
        } catch (err) {
          console.warn('Auto-receive: could not list unreceived blocks', err)
          continue
        }

        for (const tx of pending) {
          if (received.length >= MAX_RECEIVES_PER_TICK) break
          const failure = this.failures.get(tx.hash)
          if (failure && now() < failure.retryAt) continue

          try {
            await target.receive(tx.hash)
            this.failures.delete(tx.hash)
            received.push(tx.hash)
            this.deps.onReceived?.(target.address, tx)
          } catch (err) {
            const count = (failure?.count ?? 0) + 1
            const delay = Math.min(BASE_BACKOFF_MS * 2 ** (count - 1), MAX_BACKOFF_MS)
            this.failures.set(tx.hash, { count, retryAt: now() + delay })
            console.warn(`Auto-receive: receiving ${tx.hash} failed (attempt ${count})`, err)
            // The account's frontier may be stale now; try its other blocks next tick.
            break
          }
        }
      }
    } catch (err) {
      console.warn('Auto-receive: tick failed', err)
    } finally {
      this.ticking = false
    }

    // Forget failures for blocks that are no longer pending (received elsewhere).
    if (this.failures.size > 1000) this.failures.clear()
    return received
  }
}
