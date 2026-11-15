import { describe, expect, it } from 'vitest'
import { AccountBlockTemplate, KeyStore, QSR_ZTS, Zenon, ZNN_ZTS } from 'znn-typescript-sdk'
import type { KeyPair } from 'znn-typescript-sdk'
import { SwapService } from '@/core/swap-service'
import {
  COUNTER_HTLC_DURATION,
  INITIAL_HTLC_DURATION,
  applyHtlcEvent,
  derivePreimage,
  hashLockOf,
  initialHtlcError,
  nextAction,
  toHex,
  type Swap,
} from '@/core/swap-rules'

/**
 * Full HTLC swap between two testnet wallets with the wallet's own swap code:
 * A locks 0.01 ZNN for B, B checks it and locks 0.1 QSR for A, A completes
 * (revealing the derived preimage), B picks the preimage up from the HTLC
 * contract chain and unlocks A's deposit.
 *
 *   TESTNET_MNEMONIC="…" TESTNET_MNEMONIC_B="…" npm run e2e:testnet
 */

const RPC = process.env.TESTNET_RPC ?? 'https://rpc.testnet.zenon.info'
const CHAIN_ID = Number(process.env.TESTNET_CHAIN_ID ?? 73404)
const A = process.env.TESTNET_MNEMONIC ?? ''
const B = process.env.TESTNET_MNEMONIC_B ?? ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 300_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = await read()
    if (ok(v) || Date.now() > end) return v
    await sleep(4_000)
  }
}

describe.skipIf(!A || !B)('testnet: HTLC swap between two wallets', () => {
  it('swaps 0.01 ZNN for 0.1 QSR end to end', async () => {
    const zenon = Zenon.getInstance()
    Zenon.setChainID(CHAIN_ID)
    await zenon.initialize(RPC)
    const s = new SwapService({ getZenon: () => zenon, ensureInitialized: async () => {} })
    const a: KeyPair = KeyStore.fromMnemonic(A).getKeyPair(0)
    const b: KeyPair = KeyStore.fromMnemonic(B).getKeyPair(0)
    const addrA = a.getAddress().toString()
    const addrB = b.getAddress().toString()

    for (const kp of [a, b]) {
      const pending = await zenon.ledger.getUnreceivedBlocksByAddress(kp.getAddress(), 0, 10)
      for (const block of pending.list) await zenon.send(AccountBlockTemplate.receive(block.hash), kp)
    }

    // --- A starts ---
    const startHeight = await s.htlcHeight()
    const now = await s.now()
    const expiration = now + INITIAL_HTLC_DURATION
    const preimage = await derivePreimage(a.getPrivateKey(), {
      chainId: CHAIN_ID,
      self: addrA,
      hashLocked: addrB,
      expirationTime: expiration,
      zts: ZNN_ZTS.toString(),
      amount: '1000000',
    })
    const hashLock = hashLockOf(preimage)
    const initial = await zenon.send(s.create(ZNN_ZTS.toString(), 1_000_000n, addrB, expiration, hashLock), a)
    const initialId = initial.hash.toString()
    let swapA: Swap = {
      id: initialId, chainId: CHAIN_ID, direction: 'outgoing', self: addrA, counterparty: addrB, state: 'active',
      startTime: now, initialHtlcId: initialId, initialExpiration: expiration,
      send: { amount: '1000000', zts: ZNN_ZTS.toString(), symbol: 'ZNN', decimals: 8 }, hashLock,
    }

    // --- B inspects and joins ---
    const found = await until(() => s.getHtlc(initialId), (h) => h !== null)
    if (!found) throw new Error('initial HTLC not found')
    const htlc = found
    const createdAt = (await until(() => s.confirmedAt(initialId), (t) => t !== null)) ?? now
    const reused = await s.hashLockReused(htlc.hashLock, initialId, htlc.expirationTime - 24 * 3600)
    expect(reused).toBe(false)
    expect(initialHtlcError(htlc, { self: addrB, now: await s.now(), createdAt, known: [], hashLockReused: reused })).toBeNull()

    const counterExpiration = (await s.now()) + COUNTER_HTLC_DURATION
    const counter = await zenon.send(
      s.create(QSR_ZTS.toString(), 10_000_000n, htlc.timeLocked, counterExpiration, htlc.hashLock, htlc.keyMaxSize),
      b
    )
    let swapB: Swap = {
      id: initialId, chainId: CHAIN_ID, direction: 'incoming', self: addrB, counterparty: addrA, state: 'active',
      startTime: now, initialHtlcId: initialId, initialExpiration: htlc.expirationTime,
      counterHtlcId: counter.hash.toString(), counterExpiration,
      send: { amount: '10000000', zts: QSR_ZTS.toString(), symbol: 'QSR', decimals: 8 }, hashLock,
    }

    // --- A sees the counter HTLC in the contract chain, confirms and completes ---
    let scannedA = startHeight
    await until(async () => {
      const { events, height } = await s.eventsSince(scannedA, await s.htlcHeight())
      scannedA = height
      for (const e of events) swapA = applyHtlcEvent(swapA, e)
      return swapA
    }, (w) => !!w.counterHtlcId)
    expect(swapA.counterHtlcId).toBe(counter.hash.toString())
    expect(swapA.receive).toMatchObject({ amount: '10000000', zts: QSR_ZTS.toString() })
    swapA = { ...swapA, counterConfirmed: true }
    expect(nextAction(swapA, await s.now())).toBe('complete')
    await zenon.send(s.unlock(counter.hash.toString(), preimage), a)

    // --- B learns the preimage from the chain and unlocks A's deposit ---
    let scannedB = startHeight
    await until(async () => {
      const { events, height } = await s.eventsSince(scannedB, await s.htlcHeight())
      scannedB = height
      for (const e of events) swapB = applyHtlcEvent(swapB, e)
      return swapB
    }, (w) => !!w.revealedPreimage)
    expect(swapB.revealedPreimage).toBe(toHex(preimage))
    expect(nextAction(swapB, await s.now())).toBe('auto-unlock')
    await zenon.send(s.unlock(initialId, Buffer.from(swapB.revealedPreimage ?? '', 'hex')), b)

    // --- Both deposits are gone and both swaps read as completed ---
    await until(() => s.getHtlc(initialId), (h) => h === null)
    expect(await s.getHtlc(initialId)).toBeNull()
    expect(await s.getHtlc(counter.hash.toString())).toBeNull()
    // Each side scans from its own cursor, as the wallet does per chain.
    const final = await until(async () => {
      const top = await s.htlcHeight()
      const forA = await s.eventsSince(scannedA, top)
      scannedA = forA.height
      for (const e of forA.events) swapA = applyHtlcEvent(swapA, e)
      const forB = await s.eventsSince(scannedB, top)
      scannedB = forB.height
      for (const e of forB.events) swapB = applyHtlcEvent(swapB, e)
      return [swapA.state, swapB.state]
    }, ([x, y]) => x === 'completed' && y === 'completed')
    expect(final).toEqual(['completed', 'completed'])
  }, 1_800_000)
})
