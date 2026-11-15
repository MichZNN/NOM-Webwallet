import { describe, expect, it } from 'vitest'
import {
  COUNTER_HTLC_DURATION,
  INITIAL_HTLC_DURATION,
  MIN_SAFE_TIME_TO_FIND_PREIMAGE,
  applyHtlcEvent,
  derivePreimage,
  expireSwap,
  hashLockOf,
  initialHtlcError,
  nextAction,
  recoverSwaps,
  toHex,
  type HtlcEvent,
  type HtlcLike,
  type Swap,
} from './swap-rules'

const ME = 'z1me'
const THEM = 'z1them'
const NOW = 1_700_000_000
const KEY = new Uint8Array(32).fill(7)
const LOCK = 'ab'.repeat(32)
const ZNN = { amount: '100', zts: 'zts1znn', symbol: 'ZNN', decimals: 8 }

const outgoing = (o: Partial<Swap> = {}): Swap => ({
  id: 'h-init',
  chainId: 1,
  direction: 'outgoing',
  self: ME,
  counterparty: THEM,
  state: 'active',
  startTime: NOW,
  initialHtlcId: 'h-init',
  initialExpiration: NOW + INITIAL_HTLC_DURATION,
  send: ZNN,
  hashLock: LOCK,
  ...o,
})

const create = (o: Partial<Extract<HtlcEvent, { kind: 'create' }>> = {}): HtlcEvent => ({
  kind: 'create',
  hash: 'h-counter',
  creator: THEM,
  chainId: 1,
  zts: 'zts1qsr',
  symbol: 'QSR',
  decimals: 8,
  amount: '500',
  hashLocked: ME,
  expirationTime: NOW + COUNTER_HTLC_DURATION,
  hashType: 0,
  keyMaxSize: 255,
  hashLock: LOCK,
  failed: false,
  ...o,
})

describe('derivePreimage', () => {
  const ctx = { chainId: 1, self: ME, hashLocked: THEM, expirationTime: NOW, zts: 'zts1znn', amount: '100' }

  it('is deterministic, 32 bytes, and differs per swap and per key', async () => {
    const a = await derivePreimage(KEY, ctx)
    expect(a).toHaveLength(32)
    expect(toHex(await derivePreimage(KEY, ctx))).toBe(toHex(a))
    expect(toHex(await derivePreimage(KEY, { ...ctx, expirationTime: NOW + 1 }))).not.toBe(toHex(a))
    expect(toHex(await derivePreimage(KEY, { ...ctx, chainId: 73404 }))).not.toBe(toHex(a))
    expect(toHex(await derivePreimage(KEY, { ...ctx, amount: '101' }))).not.toBe(toHex(a))
    expect(toHex(await derivePreimage(KEY, { ...ctx, zts: 'zts1qsr' }))).not.toBe(toHex(a))
    expect(toHex(await derivePreimage(new Uint8Array(32).fill(8), ctx))).not.toBe(toHex(a))
  })

  it('hashes to a 32-byte SHA3 lock', async () => {
    expect(hashLockOf(await derivePreimage(KEY, ctx))).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('initialHtlcError', () => {
  const htlc: HtlcLike = {
    id: 'h-init',
    timeLocked: THEM,
    hashLocked: ME,
    zts: 'zts1znn',
    amount: 100n,
    expirationTime: NOW + INITIAL_HTLC_DURATION,
    hashType: 0,
    keyMaxSize: 255,
    hashLock: LOCK,
  }
  const ctx = { self: ME, now: NOW, createdAt: NOW, known: [] as Swap[], hashLockReused: false }

  it('accepts a fresh deposit for me', () => {
    expect(initialHtlcError(htlc, ctx)).toBeNull()
  })

  it.each([
    [{ hashLocked: 'z1other' }, {}, /not for this address/],
    [{ timeLocked: ME }, {}, /you started/],
    [{ hashType: 1 }, {}, /hash type/],
    [{ keyMaxSize: 31 }, {}, /key size/],
    [{ expirationTime: NOW - 1 }, {}, /expired/],
    [{ expirationTime: NOW + MIN_SAFE_TIME_TO_FIND_PREIMAGE + COUNTER_HTLC_DURATION - 1 }, {}, /too soon/],
    [{ expirationTime: NOW + 25 * 3600 }, {}, /longer than 24 hours/],
    [{}, { createdAt: NOW - 20 * 3600 }, /too long ago/],
    [{}, { hashLockReused: true }, /not unique/],
    [{}, { known: [outgoing({ id: 'x', initialHtlcId: 'x', hashLock: LOCK })] }, /hashlock is already used/],
  ] as const)('rejects %o %o', (patch, ctxPatch, message) => {
    expect(initialHtlcError({ ...htlc, ...patch }, { ...ctx, ...ctxPatch })).toMatch(message)
  })
})

describe('outgoing swap', () => {
  it('goes pending -> active -> sees the counter HTLC -> completed', () => {
    let s = outgoing({ state: 'pending' })
    s = applyHtlcEvent(s, create({ hash: 'h-init', creator: ME, hashLocked: THEM }))
    expect(s.state).toBe('active')
    s = applyHtlcEvent(s, create())
    expect(s).toMatchObject({ counterHtlcId: 'h-counter', receive: { amount: '500', symbol: 'QSR' } })
    expect(nextAction(s, NOW)).toBe('confirm-counter')
    expect(nextAction({ ...s, counterConfirmed: true }, NOW)).toBe('complete')
    s = applyHtlcEvent(s, { kind: 'unlock', id: 'h-counter', preimage: '00', executed: true })
    expect(s.state).toBe('completed')
  })

  it.each([
    { creator: 'z1stranger' },
    { hashLocked: 'z1other' },
    { hashLock: 'cd'.repeat(32) },
    { hashType: 1 },
    { keyMaxSize: 8 },
    { chainId: 73404 },
  ])('ignores a counter HTLC with %o', (patch) => {
    expect(applyHtlcEvent(outgoing(), create(patch)).counterHtlcId).toBeUndefined()
  })

  it('ignores unlocks and reclaims that were not executed', () => {
    const s = outgoing({ counterHtlcId: 'h-counter' })
    expect(applyHtlcEvent(s, { kind: 'unlock', id: 'h-counter', preimage: '00', executed: false }).state).toBe('active')
    expect(applyHtlcEvent(s, { kind: 'reclaim', id: 'h-init', executed: false }).state).toBe('active')
  })

  it('becomes reclaimable after expiry and unsuccessful after reclaim', () => {
    const s = expireSwap(outgoing(), NOW + INITIAL_HTLC_DURATION)
    expect(s.state).toBe('reclaimable')
    expect(nextAction(s, NOW + INITIAL_HTLC_DURATION)).toBe('reclaim')
    expect(nextAction(s, NOW + INITIAL_HTLC_DURATION - 1)).toBe('wait-reclaim')
    expect(applyHtlcEvent(s, { kind: 'reclaim', id: 'h-init', executed: true }).state).toBe('unsuccessful')
  })

  it('stops offering completion close to the counter expiry', () => {
    const s = outgoing({ counterHtlcId: 'h-counter', counterExpiration: NOW + 300, counterConfirmed: true })
    expect(nextAction(s, NOW)).toBeNull()
    expect(expireSwap(s, NOW).state).toBe('reclaimable')
  })
})

describe('incoming swap', () => {
  it('learns the preimage from the unlock of its counter HTLC and completes', async () => {
    const preimage = await derivePreimage(KEY, { chainId: 1, self: THEM, hashLocked: ME, expirationTime: NOW, zts: 'zts1znn', amount: '100' })
    const lock = hashLockOf(preimage)
    let s: Swap = {
      ...outgoing({ direction: 'incoming', counterparty: THEM, hashLock: lock, state: 'pending' }),
      counterHtlcId: 'h-counter',
      counterExpiration: NOW + COUNTER_HTLC_DURATION,
    }
    s = applyHtlcEvent(s, create({ hash: 'h-counter', creator: ME, hashLocked: THEM, hashLock: lock }))
    expect(s.state).toBe('active')

    // A wrong preimage is ignored.
    expect(applyHtlcEvent(s, { kind: 'unlock', id: 'h-counter', preimage: '00'.repeat(32), executed: true }).revealedPreimage).toBeUndefined()

    s = applyHtlcEvent(s, { kind: 'unlock', id: 'h-counter', preimage: toHex(preimage), executed: true })
    expect(s.revealedPreimage).toBe(toHex(preimage))
    expect(nextAction(s, NOW)).toBe('auto-unlock')
    // Even after the counter HTLC expired, there is time until the initial one does.
    expect(expireSwap(s, NOW + 2 * COUNTER_HTLC_DURATION).state).toBe('active')

    s = applyHtlcEvent(s, { kind: 'unlock', id: 'h-init', preimage: toHex(preimage), executed: true })
    expect(s.state).toBe('completed')
  })
})

describe('review fixes', () => {
  it('ignores a counter HTLC the contract rejected', () => {
    expect(applyHtlcEvent(outgoing(), create({ failed: true })).counterHtlcId).toBeUndefined()
  })

  it('marks our own rejected Create as unsuccessful', () => {
    const s = applyHtlcEvent(outgoing({ state: 'pending' }), create({ hash: 'h-init', creator: ME, hashLocked: THEM, failed: true }))
    expect(s.state).toBe('unsuccessful')
  })

  it('still claims when the initiator completes in the last minutes of our deposit', async () => {
    const preimage = new Uint8Array(32).fill(9)
    const lock = hashLockOf(preimage)
    const counterExpiration = NOW + COUNTER_HTLC_DURATION
    let s: Swap = {
      ...outgoing({ direction: 'incoming', hashLock: lock }),
      counterHtlcId: 'h-counter',
      counterExpiration,
    }
    // 5 minutes before our deposit expires the wallet already calls it expired...
    s = expireSwap(s, counterExpiration - 300)
    expect(s.state).toBe('reclaimable')
    // ...but the initiator can still unlock it, which reveals the preimage.
    s = applyHtlcEvent(s, { kind: 'unlock', id: 'h-counter', preimage: toHex(preimage), executed: true })
    expect(s.state).toBe('active')
    expect(nextAction(s, counterExpiration + 3600)).toBe('auto-unlock')
    // It keeps trying until the initial HTLC itself expires, and never asks to reclaim.
    expect(expireSwap(s, s.initialExpiration - 1).state).toBe('active')
    expect(nextAction(s, s.initialExpiration - 1)).toBe('auto-unlock')
    expect(nextAction(s, s.initialExpiration)).toBeNull()
  })
})

describe('recoverSwaps', () => {
  const ctx = { self: ME, chainId: 1, now: NOW + 600 }
  const myInitial = create({ hash: 'h-init', creator: ME, hashLocked: THEM, expirationTime: NOW + INITIAL_HTLC_DURATION, zts: 'zts1znn', symbol: 'ZNN', amount: '100' })

  it('rebuilds a started swap and finds the counter deposit made since', () => {
    const counter = create({ hash: 'h-counter' })
    const [swap] = recoverSwaps(ctx, [{ create: myInitial as never, initiated: true }], [myInitial, counter])
    expect(swap).toMatchObject({
      direction: 'outgoing',
      state: 'active',
      counterparty: THEM,
      initialHtlcId: 'h-init',
      counterHtlcId: 'h-counter',
      send: { amount: '100', symbol: 'ZNN' },
      receive: { amount: '500', symbol: 'QSR' },
    })
    expect(swap.counterConfirmed).toBeUndefined() // the user reviews it again
  })

  it('rebuilds a joined swap, including a preimage revealed meanwhile', async () => {
    const preimage = new Uint8Array(32).fill(5)
    const lock = hashLockOf(preimage)
    const theirs = create({ hash: 'h-init', creator: THEM, hashLocked: ME, hashLock: lock, expirationTime: NOW + INITIAL_HTLC_DURATION })
    const mine = create({ hash: 'h-counter', creator: ME, hashLocked: THEM, hashLock: lock, expirationTime: NOW + COUNTER_HTLC_DURATION, zts: 'zts1znn', symbol: 'ZNN' })
    const reveal: HtlcEvent = { kind: 'unlock', id: 'h-counter', preimage: toHex(preimage), executed: true }
    const [swap] = recoverSwaps(ctx, [{ create: mine as never, initiated: false }], [theirs, mine, reveal])
    expect(swap).toMatchObject({ direction: 'incoming', id: 'h-init', counterHtlcId: 'h-counter', revealedPreimage: toHex(preimage) })
    expect(nextAction(swap, ctx.now)).toBe('auto-unlock')
  })

  it('drops finished swaps and counter deposits without a matching initial', () => {
    const done: HtlcEvent = { kind: 'reclaim', id: 'h-init', executed: true }
    expect(recoverSwaps(ctx, [{ create: myInitial as never, initiated: true }], [myInitial, done])).toEqual([])
    const orphan = create({ hash: 'h-x', creator: ME, hashLocked: THEM })
    expect(recoverSwaps(ctx, [{ create: orphan as never, initiated: false }], [orphan])).toEqual([])
  })
})
