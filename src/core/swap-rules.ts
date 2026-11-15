/**
 * Peer-to-peer atomic swaps through the HTLC embedded contract, the way
 * Syrius does them (blocs/p2p_swap/htlc_swap, handlers/htlc_swaps_handler.dart),
 * checked against go-zenon vm/embedded/implementation/htlc.go.
 *
 * Flow: the initiator locks funds for the counterparty under hash(preimage)
 * (initial HTLC, 8h). The counterparty checks it and locks their side for the
 * initiator under the same hash (counter HTLC, 1h). The initiator unlocks the
 * counter HTLC, which reveals the preimage on chain; the counterparty then uses
 * it to unlock the initial HTLC. Either side reclaims its own HTLC after expiry.
 *
 * Free of Vue and storage so it runs under unit tests.
 */
import {Hash} from 'znn-typescript-sdk'

const HOUR = 3600

export const HASH_TYPE_SHA3 = 0
export const PREIMAGE_LENGTH = 32
export const KEY_MAX_SIZE = 255 // go-zenon/Syrius htlcPreimageMaxLength
export const INITIAL_HTLC_DURATION = 8 * HOUR
export const COUNTER_HTLC_DURATION = 1 * HOUR
export const MAX_INITIAL_HTLC_DURATION = 24 * HOUR
/** Time the joiner keeps after the counter HTLC expires to pick up the preimage. */
export const MIN_SAFE_TIME_TO_FIND_PREIMAGE = 6 * HOUR
/** Don't publish an unlock this close to expiry: it might land too late. */
export const MIN_SAFE_TIME_TO_COMPLETE = 10 * 60

export type SwapDirection = 'outgoing' | 'incoming'
/**
 * pending: our HTLC is published, not yet received by the contract
 * active: HTLCs are in place, waiting for the other side
 * completed: we got the other side's funds
 * reclaimable: the swap can't complete any more; our HTLC can be reclaimed after expiry
 * unsuccessful: we reclaimed our funds
 */
export type SwapState = 'pending' | 'active' | 'completed' | 'reclaimable' | 'unsuccessful'

export interface TokenAmount {
  amount: string // base units
  zts: string
  symbol: string
  decimals: number
}

export interface Swap {
  /** The initial HTLC id; identifies the swap. */
  id: string
  chainId: number
  direction: SwapDirection
  self: string
  counterparty: string
  state: SwapState
  startTime: number
  initialHtlcId: string
  initialExpiration: number
  counterHtlcId?: string
  counterExpiration?: number
  /** What we lock. */
  send: TokenAmount
  /** What we get (known once the other HTLC is seen). */
  receive?: TokenAmount
  /** SHA3 hashlock, hex. */
  hashLock: string
  /**
   * Hex preimage, only stored once it is public on chain (incoming swaps).
   * The initiator never stores it: it is derived from the account key.
   */
  revealedPreimage?: string
  /** Outgoing: the user confirmed the counter HTLC's amount and token. */
  counterConfirmed?: boolean
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

/**
 * Deterministic preimage: HMAC-SHA256 over on-chain swap parameters keyed by
 * the account's private key. Nothing secret is stored, it can only be computed
 * while the wallet is unlocked, and it can be recovered from the mnemonic.
 */
export async function derivePreimage(
  privateKey: Uint8Array,
  ctx: { chainId: number; self: string; hashLocked: string; expirationTime: number }
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(privateKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const message = new TextEncoder().encode(
    `nom-htlc-v1|${ctx.chainId}|${ctx.self}|${ctx.hashLocked}|${ctx.expirationTime}`
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
}

/** SHA3-256 hashlock of a preimage, hex (hash type 0). */
export function hashLockOf(preimage: Uint8Array): string {
  return Hash.digest(Buffer.from(preimage)).toString()
}

export interface HtlcLike {
  id: string
  timeLocked: string
  hashLocked: string
  zts: string
  amount: bigint
  expirationTime: number
  hashType: number
  keyMaxSize: number
  hashLock: string // hex
}

/**
 * The joiner's checks before locking funds against an initial HTLC
 * (Syrius initial_htlc_for_swap_bloc.dart, plus hash type and key size).
 * `now` is the frontier momentum time.
 */
export function initialHtlcError(
  htlc: HtlcLike,
  ctx: {
    self: string
    now: number
    /** Momentum time of the HTLC's creation block. */
    createdAt: number
    known: readonly Swap[]
    /** Another HTLC Create used the same hashlock (scan of the contract chain). */
    hashLockReused: boolean
  }
): string | null {
  if (htlc.hashLocked !== ctx.self) return 'This deposit is not for this address.'
  if (htlc.timeLocked === ctx.self) return 'You cannot join a swap you started.'
  if (ctx.known.some((s) => s.initialHtlcId === htlc.id || s.counterHtlcId === htlc.id)) {
    return 'This deposit is already part of a swap.'
  }
  if (ctx.known.some((s) => s.hashLock === htlc.hashLock)) {
    return 'This deposit’s hashlock is already used in another swap.'
  }
  if (htlc.hashType !== HASH_TYPE_SHA3) return 'Unsupported hash type (only SHA3).'
  if (htlc.hashLock.length !== 64) return 'Invalid hashlock.'
  if (htlc.keyMaxSize < PREIMAGE_LENGTH) return 'The deposit’s key size is too small.'
  const remaining = htlc.expirationTime - ctx.now
  if (remaining <= 0) return 'This deposit has expired.'
  if (remaining < MIN_SAFE_TIME_TO_FIND_PREIMAGE + COUNTER_HTLC_DURATION) {
    return 'This deposit expires too soon for a safe swap.'
  }
  if (remaining > MAX_INITIAL_HTLC_DURATION) return 'This deposit runs longer than 24 hours.'
  if (htlc.expirationTime - ctx.createdAt > MAX_INITIAL_HTLC_DURATION) {
    return 'This deposit was created too long ago.'
  }
  if (ctx.hashLockReused) return 'The hashlock is not unique.'
  return null
}

/** Decoded HTLC contract activity, from a contract-receive block on the HTLC address. */
export type HtlcEvent =
  | {
      kind: 'create'
      hash: string
      creator: string
      chainId: number
      zts: string
      symbol: string
      decimals: number
      amount: string
      hashLocked: string
      expirationTime: number
      hashType: number
      keyMaxSize: number
      hashLock: string
    }
  | { kind: 'unlock'; id: string; preimage: string; executed: boolean }
  | { kind: 'reclaim'; id: string; executed: boolean }

/** Initiator's checks on a counter HTLC (Syrius htlc_swaps_handler _isValidCounterHtlc). */
export function isValidCounterHtlc(swap: Swap, e: Extract<HtlcEvent, { kind: 'create' }>): boolean {
  return (
    e.hashLock === swap.hashLock &&
    e.hashLocked === swap.self &&
    e.creator === swap.counterparty &&
    e.hashType === HASH_TYPE_SHA3 &&
    e.keyMaxSize >= PREIMAGE_LENGTH &&
    e.chainId === swap.chainId
  )
}

/** Apply one HTLC contract event to a swap; returns the swap unchanged if it doesn't concern it. */
export function applyHtlcEvent(swap: Swap, e: HtlcEvent): Swap {
  if (swap.state === 'completed' || swap.state === 'unsuccessful') return swap
  switch (e.kind) {
    case 'create': {
      // Our own HTLC was received by the contract.
      if (e.hash === swap.initialHtlcId && swap.direction === 'outgoing' && swap.state === 'pending') {
        return { ...swap, state: 'active' }
      }
      if (e.hash === swap.counterHtlcId && swap.direction === 'incoming' && swap.state === 'pending') {
        return { ...swap, state: 'active' }
      }
      // The counterparty's answer to our swap.
      if (
        swap.direction === 'outgoing' &&
        swap.state === 'active' &&
        !swap.counterHtlcId &&
        e.hash !== swap.initialHtlcId &&
        isValidCounterHtlc(swap, e)
      ) {
        return {
          ...swap,
          counterHtlcId: e.hash,
          counterExpiration: e.expirationTime,
          receive: { amount: e.amount, zts: e.zts, symbol: e.symbol, decimals: e.decimals },
        }
      }
      return swap
    }
    case 'unlock': {
      if (!e.executed) return swap
      if (e.id === swap.counterHtlcId && swap.direction === 'outgoing') {
        // Our counter HTLC got unlocked (by us or a proxy): we got paid.
        return { ...swap, state: 'completed' }
      }
      if (e.id === swap.counterHtlcId && swap.direction === 'incoming') {
        // The initiator took our deposit and revealed the preimage.
        if (hashLockOf(Buffer.from(e.preimage, 'hex')) !== swap.hashLock) return swap
        return { ...swap, revealedPreimage: e.preimage }
      }
      if (e.id === swap.initialHtlcId && swap.direction === 'incoming') {
        return { ...swap, state: 'completed', revealedPreimage: swap.revealedPreimage ?? e.preimage }
      }
      return swap
    }
    case 'reclaim': {
      if (!e.executed) return swap
      const own = swap.direction === 'outgoing' ? swap.initialHtlcId : swap.counterHtlcId
      return e.id === own ? { ...swap, state: 'unsuccessful' } : swap
    }
  }
}

/** Our own HTLC id and its expiry. */
export function ownHtlc(swap: Swap): { id?: string; expiration?: number } {
  return swap.direction === 'outgoing'
    ? { id: swap.initialHtlcId, expiration: swap.initialExpiration }
    : { id: swap.counterHtlcId, expiration: swap.counterExpiration }
}

/** Mark swaps that can no longer complete safely (Syrius _checkForExpiredSwaps). */
export function expireSwap(swap: Swap, now: number): Swap {
  if (swap.state !== 'pending' && swap.state !== 'active') return swap
  // An incoming swap whose preimage is known can still complete until the initial HTLC expires.
  if (swap.direction === 'incoming' && swap.revealedPreimage) {
    return now >= swap.initialExpiration - MIN_SAFE_TIME_TO_COMPLETE ? { ...swap, state: 'reclaimable' } : swap
  }
  const counterTooLate =
    swap.counterExpiration !== undefined && now >= swap.counterExpiration - MIN_SAFE_TIME_TO_COMPLETE
  if (now >= swap.initialExpiration || counterTooLate) return { ...swap, state: 'reclaimable' }
  return swap
}

/** What the user can do now. */
export function nextAction(
  swap: Swap,
  now: number
): 'confirm-counter' | 'complete' | 'auto-unlock' | 'reclaim' | 'wait-reclaim' | null {
  if (swap.state === 'active') {
    if (swap.direction === 'outgoing' && swap.counterHtlcId && swap.counterExpiration !== undefined) {
      if (now >= swap.counterExpiration - MIN_SAFE_TIME_TO_COMPLETE) return null
      return swap.counterConfirmed ? 'complete' : 'confirm-counter'
    }
    if (swap.direction === 'incoming' && swap.revealedPreimage) {
      return now < swap.initialExpiration - MIN_SAFE_TIME_TO_COMPLETE ? 'auto-unlock' : null
    }
    return null
  }
  if (swap.state === 'reclaimable') {
    const own = ownHtlc(swap)
    if (!own.id || own.expiration === undefined) return null
    return now >= own.expiration ? 'reclaim' : 'wait-reclaim'
  }
  return null
}

export { hex as toHex }
