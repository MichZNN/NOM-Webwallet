import type {SwapService} from './swap-service'
import {RECOVERY_WINDOW, derivePreimage, hashLockOf, recoverSwaps} from './swap-rules'
import type {Swap} from './swap-rules'

/**
 * Find this account's open swaps on chain, without any local records: its own
 * HTLC Create calls from the last 25 hours, classified by whether the derived
 * preimage opens their hashlock (we started it) or not (our counter deposit),
 * then replayed against the HTLC contract's events of the same window.
 */
export async function recoverAccountSwaps(
  service: SwapService,
  self: string,
  privateKey: Uint8Array
): Promise<{ chainId: number; height: number; swaps: Swap[] }> {
  const [chainId, now] = await Promise.all([service.chainId(), service.now()])
  const since = now - RECOVERY_WINDOW
  const [creates, window] = await Promise.all([service.ownCreatesSince(self, since), service.eventsInWindow(since)])

  const own = await Promise.all(
    creates.map(async (create) => {
      const preimage = await derivePreimage(privateKey, {
        chainId,
        self,
        hashLocked: create.hashLocked,
        expirationTime: create.expirationTime,
        zts: create.zts,
        amount: create.amount,
      })
      return { create, initiated: hashLockOf(preimage) === create.hashLock }
    })
  )
  return {
    chainId,
    height: window.height,
    swaps: recoverSwaps({ self, chainId, now }, own, window.events),
  }
}
