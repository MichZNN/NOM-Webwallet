import {ref} from 'vue'
import type {KeyPair} from 'znn-typescript-sdk'
import {STORAGE_KEY_SWAPS, SWAP_POLL_MS} from '@/config'
import {sessionManager} from '../session-manager'
import {storageService} from '../storage/storage-service'
import {createSerialQueue} from '../serial-queue'
import {SwapService} from '../swap-service'
import {recoverAccountSwaps} from '../swap-recovery'
import {
  COUNTER_HTLC_DURATION,
  INITIAL_HTLC_DURATION,
  MAX_INITIAL_HTLC_DURATION,
  MIN_SAFE_TIME_TO_COMPLETE,
  applyHtlcEvent,
  derivePreimage,
  expireSwap,
  hashLockOf,
  initialHtlcError,
  nextAction,
  ownHtlc,
  toHex,
} from '../swap-rules'
import type {HtlcLike, Swap, TokenAmount} from '../swap-rules'
import {TransactionService} from '../transaction-service'
import {WalletService} from '../wallet-service'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'
import {isLedgerKeyPair} from '../ledger/ledger-sign'

interface ChainStore {
  swaps: Swap[]
  /** HTLC contract height already scanned. */
  height: number
}
type Store = Record<string, ChainStore>

// Module-level: one swap state per page.
const swaps = ref<Swap[]>([])
const chainNow = ref(0)
const isBusy = ref(false)
const error = ref<string | null>(null)
const storeQueue = createSerialQueue()
let timer: ReturnType<typeof setInterval> | null = null
let reconciling = false
/** Swap id -> time of the last auto-unlock attempt, so it isn't re-sent every scan. */
const unlockAttempts = new Map<string, number>()
const UNLOCK_RETRY_MS = 5 * 60_000 // longer than a send's timeout, so attempts don't stack

const service = () => SwapService.getInstance()

async function readStore(): Promise<Store> {
  return (await storageService.get<Store>(STORAGE_KEY_SWAPS)) ?? {}
}

const isOpen = (w: Swap) => w.state !== 'completed' && w.state !== 'unsuccessful'

/**
 * Serialise read-modify-write of the swap store across windows and tabs (the
 * extension popup, a full tab, the web app in two tabs) with the Web Locks
 * API, falling back to a per-window queue.
 */
function withStoreLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? (locks.request('nom-wallet-htlc-swaps', run) as Promise<T>) : storeQueue(run)
}

/** Read-modify-write of one chain's swaps. Keep `change` fast: no node calls inside. */
function updateChain(chainId: number, change: (c: ChainStore) => ChainStore | Promise<ChainStore>) {
  return withStoreLock(async () => {
    const store = await readStore()
    const current = store[chainId] ?? { swaps: [], height: 0 }
    const next = await change(current)
    store[chainId] = next
    await storageService.set(STORAGE_KEY_SWAPS, store)
    swaps.value = next.swaps
    return next
  })
}

/** Key pair for an address, from any unlocked wallet that holds it; null if none. */
async function keyPairFor(address: string): Promise<KeyPair | null> {
  const { wallets } = await WalletService.getInstance().getSnapshot()
  for (const wallet of wallets) {
    const account = wallet.accounts.find((a) => a.address === address)
    const keyStore = account ? sessionManager.getKeyStore(wallet.baseAddress) : null
    if (account && keyStore) return keyStore.getKeyPair(account.index)
  }
  return null
}

/** Re-derive an outgoing swap's preimage and make sure it opens the hashlock. */
async function preimageFor(swap: Swap, keyPair: KeyPair): Promise<Uint8Array> {
  const preimage = await derivePreimage(keyPair.getPrivateKey(), {
    chainId: swap.chainId,
    self: swap.self,
    hashLocked: swap.counterparty,
    expirationTime: swap.initialExpiration,
    zts: swap.send.zts,
    amount: swap.send.amount,
  })
  if (hashLockOf(preimage) !== swap.hashLock) throw new Error('The swap secret does not match this account')
  return preimage
}

/**
 * Scan the HTLC contract for news on our swaps, mark expired ones, and unlock
 * incoming swaps whose preimage has been revealed (if the wallet is unlocked).
 */
async function reconcile(): Promise<void> {
  if (reconciling) return
  reconciling = true
  try {
    // Nothing open on any chain: no node calls at all.
    const stored = await readStore()
    if (!Object.values(stored).some((c) => c.swaps.some(isOpen))) return
    const s = service()
    const [chainId, now, top] = await Promise.all([s.chainId(), s.now(), s.htlcHeight()])
    chainNow.value = now
    const before = stored[chainId] ?? { swaps: [], height: 0 }
    const openHere = before.swaps.some(isOpen)
    // Scan outside the store lock (it can take a while), then merge.
    const scan = openHere ? await s.eventsSince(before.height, top) : { events: [], height: top }
    const next = await updateChain(chainId, (c) => {
      let list = c.swaps
      for (const e of scan.events) list = list.map((w) => applyHtlcEvent(w, e))
      list = list.map((w) => expireSwap(w, now))
      return { swaps: list, height: Math.max(c.height, scan.height) }
    })
    for (const swap of next.swaps) {
      if (nextAction(swap, now) === 'auto-unlock') await autoUnlock(swap)
    }
  } catch (err) {
    console.warn('Swap reconcile failed', err)
  } finally {
    reconciling = false
  }
}

/** The joiner's side: claim the initial HTLC with the revealed preimage. */
async function autoUnlock(swap: Swap): Promise<void> {
  if (!swap.revealedPreimage) return
  const last = unlockAttempts.get(swap.id)
  if (last && Date.now() - last < UNLOCK_RETRY_MS) return
  const keyPair = await keyPairFor(swap.self)
  if (!keyPair) return // locked: done on the next unlock
  unlockAttempts.set(swap.id, Date.now())
  try {
    const block = await TransactionService.getInstance().sendEmbeddedInBackground(
      service().unlock(swap.initialHtlcId, Buffer.from(swap.revealedPreimage, 'hex')),
      keyPair
    )
    trackTransaction(`Swap: receive ${swap.receive?.symbol ?? ''}`.trim(), block)
  } catch (err) {
    console.warn('Swap auto-unlock failed', err)
  }
}

async function withKey<T>(address: string, label: string, run: (k: KeyPair) => Promise<T>): Promise<T> {
  if (isBusy.value) throw new Error('Another action is still running')
  const keyPair = await keyPairFor(address)
  if (!keyPair) throw new Error('Wallet is locked. Please unlock it first.')
  // Swaps need the account key (derived secret) and background claiming,
  // neither of which a Ledger provides.
  if (isLedgerKeyPair(keyPair)) throw new Error('P2P swaps are not available for Ledger accounts')
  isBusy.value = true
  error.value = null
  try {
    return await runActivity(label, () => run(keyPair))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Swap action failed'
    throw err
  } finally {
    isBusy.value = false
  }
}

export interface JoinCandidate {
  htlc: HtlcLike
  receive: TokenAmount
  now: number
}

/** P2P swaps over HTLCs (Syrius-compatible), with a scan loop while the wallet is open. */
export function useSwaps() {
  async function load(): Promise<void> {
    const chainId = await service().chainId()
    swaps.value = (await readStore())[chainId]?.swaps ?? []
    await reconcile()
  }

  function start(): void {
    if (timer !== null) return
    timer = setInterval(() => void reconcile(), SWAP_POLL_MS)
    window.addEventListener('wallet-status-changed', () => void reconcile())
    void load()
  }

  /** Initiator: lock `send` for the counterparty under a derived hashlock. */
  async function startSwap(self: string, counterparty: string, send: TokenAmount): Promise<Swap> {
    if (counterparty === self) throw new Error('You cannot swap with yourself')
    return withKey(self, `Start swap: ${send.symbol}`, async (keyPair) => {
      const s = service()
      const [chainId, now, height] = await Promise.all([s.chainId(), s.now(), s.htlcHeight()])
      const known = (await readStore())[chainId]?.swaps ?? []
      let expirationTime = now + INITIAL_HTLC_DURATION
      // The preimage is derived from these values: keep them unique per swap.
      while (known.some((w) => w.direction === 'outgoing' && w.counterparty === counterparty && w.initialExpiration === expirationTime)) {
        expirationTime++
      }
      const preimage = await derivePreimage(keyPair.getPrivateKey(), {
        chainId,
        self,
        hashLocked: counterparty,
        expirationTime,
        zts: send.zts,
        amount: send.amount,
      })
      const hashLock = hashLockOf(preimage)
      const block = await TransactionService.getInstance().sendEmbeddedContractBlock(
        s.create(send.zts, BigInt(send.amount), counterparty, expirationTime, hashLock),
        keyPair
      )
      trackTransaction(`Start swap: ${send.symbol}`, block)
      const swap: Swap = {
        id: block.hash.toString(),
        chainId,
        direction: 'outgoing',
        self,
        counterparty,
        state: 'pending',
        startTime: now,
        initialHtlcId: block.hash.toString(),
        initialExpiration: expirationTime,
        send,
        hashLock,
      }
      await updateChain(chainId, (c) => ({
        swaps: [swap, ...c.swaps],
        // Nothing open on this chain: the old height is stale, start scanning here.
        height: c.swaps.some(isOpen) ? c.height : Math.max(0, height - 1),
      }))
      return swap
    })
  }

  /** Joiner: fetch and check an initial HTLC before committing anything. */
  async function inspect(self: string, initialHtlcId: string): Promise<JoinCandidate> {
    const s = service()
    const id = initialHtlcId.trim().replace(/^0x/, '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('A swap ID is a 64-character hex hash')
    const htlc = await s.getHtlc(id)
    if (!htlc) throw new Error('No open deposit with this ID (it may be unlocked, reclaimed or on another network)')
    const [chainId, now, createdAt] = await Promise.all([s.chainId(), s.now(), s.confirmedAt(id)])
    const known = (await readStore())[chainId]?.swaps ?? []
    const reused = await s.hashLockReused(htlc.hashLock, htlc.id, htlc.expirationTime - MAX_INITIAL_HTLC_DURATION)
    const problem = initialHtlcError(htlc, { self, now, createdAt: createdAt ?? now, known, hashLockReused: reused })
    if (problem) throw new Error(problem)
    const token = await s.tokenInfo(htlc.zts)
    if (!token) throw new Error('Unknown token in this deposit')
    return { htlc, now, receive: { amount: htlc.amount.toString(), zts: htlc.zts, ...token } }
  }

  /** Joiner: lock `send` for the initiator under the same hashlock, for 1 hour. */
  async function joinSwap(self: string, candidate: JoinCandidate, send: TokenAmount): Promise<Swap> {
    const { htlc } = candidate
    return withKey(self, `Join swap: ${send.symbol}`, async (keyPair) => {
      const s = service()
      const [chainId, now, height] = await Promise.all([s.chainId(), s.now(), s.htlcHeight()])
      // Re-check right before locking funds: time has passed since inspect().
      const known = (await readStore())[chainId]?.swaps ?? []
      const problem = initialHtlcError(htlc, { self, now, createdAt: now, known, hashLockReused: false })
      if (problem) throw new Error(problem)
      const counterExpiration = now + COUNTER_HTLC_DURATION
      const block = await TransactionService.getInstance().sendEmbeddedContractBlock(
        s.create(send.zts, BigInt(send.amount), htlc.timeLocked, counterExpiration, htlc.hashLock, htlc.keyMaxSize),
        keyPair
      )
      trackTransaction(`Join swap: ${send.symbol}`, block)
      const swap: Swap = {
        id: htlc.id,
        chainId,
        direction: 'incoming',
        self,
        counterparty: htlc.timeLocked,
        state: 'pending',
        startTime: now,
        initialHtlcId: htlc.id,
        initialExpiration: htlc.expirationTime,
        counterHtlcId: block.hash.toString(),
        counterExpiration,
        send,
        receive: candidate.receive,
        hashLock: htlc.hashLock,
      }
      await updateChain(chainId, (c) => ({
        swaps: [swap, ...c.swaps],
        height: c.swaps.some(isOpen) ? c.height : Math.max(0, height - 1),
      }))
      return swap
    })
  }

  /** Initiator: the user accepts what the counterparty locked. */
  async function confirmCounter(swap: Swap): Promise<void> {
    await updateChain(swap.chainId, (c) => ({
      ...c,
      swaps: c.swaps.map((w) => (w.id === swap.id ? { ...w, counterConfirmed: true } : w)),
    }))
  }

  /** Initiator: take the counter HTLC, revealing the preimage. */
  async function completeSwap(swap: Swap): Promise<void> {
    const counterId = swap.counterHtlcId
    if (swap.direction !== 'outgoing' || !counterId || !swap.counterConfirmed) {
      throw new Error('Nothing to complete yet')
    }
    await withKey(swap.self, `Complete swap: ${swap.receive?.symbol ?? ''}`.trim(), async (keyPair) => {
      const s = service()
      const counter = await s.getHtlc(counterId)
      if (!counter) throw new Error('The counterparty’s deposit is gone (reclaimed or already unlocked)')
      const chainTime = await s.now()
      const deadline = counter.expirationTime - MIN_SAFE_TIME_TO_COMPLETE
      if (chainTime >= deadline) throw new Error('The counterparty’s deposit expires too soon to complete safely')
      const preimage = await preimageFor(swap, keyPair)
      // The unlock reveals the preimage even if it arrives too late. The send can
      // wait in the queue and on PoW, so check the deadline again right before
      // publishing (chain time estimated from the local clock).
      const offset = chainTime - Math.floor(Date.now() / 1000)
      const beforePublish = () => {
        if (Math.floor(Date.now() / 1000) + offset >= deadline) {
          throw new Error('Too close to the counterparty’s expiry; not completing (your secret was not published)')
        }
      }
      const block = await TransactionService.getInstance().sendEmbeddedContractBlock(
        s.unlock(counterId, preimage),
        keyPair,
        beforePublish
      )
      trackTransaction(`Complete swap: ${swap.receive?.symbol ?? ''}`.trim(), block)
    })
    void reconcile()
  }

  /** Either side: take back our own HTLC after it expired. */
  async function reclaim(swap: Swap): Promise<void> {
    const own = ownHtlc(swap)
    if (!own.id) throw new Error('Nothing to reclaim')
    const id = own.id
    await withKey(swap.self, `Reclaim swap: ${swap.send.symbol}`, async (keyPair) => {
      const block = await TransactionService.getInstance().sendEmbeddedContractBlock(service().reclaim(id), keyPair)
      trackTransaction(`Reclaim swap: ${swap.send.symbol}`, block)
    })
    void reconcile()
  }

  /**
   * Find this account's open swaps on chain (e.g. after browser data was
   * cleared) and add the ones not tracked yet. Needs the unlocked wallet: the
   * account key tells our own swaps apart. Returns how many were added.
   */
  async function recover(self: string): Promise<number> {
    const found = await withKey(self, 'Looking for your swaps on chain', (keyPair) =>
      recoverAccountSwaps(service(), self, keyPair.getPrivateKey())
    )
    let added = 0
    await updateChain(found.chainId, (c) => {
      const fresh = found.swaps.filter((w) => !c.swaps.some((x) => x.id === w.id))
      added = fresh.length
      if (!fresh.length) return c
      // Events up to found.height are already applied to the recovered swaps.
      const height = c.swaps.some(isOpen) ? Math.min(c.height, found.height) : found.height
      return { swaps: [...fresh, ...c.swaps], height }
    })
    void reconcile()
    return added
  }

  return {
    swaps,
    chainNow,
    recover,
    isBusy,
    error,
    start,
    load,
    reconcile,
    startSwap,
    inspect,
    joinSwap,
    confirmCounter,
    completeSwap,
    reclaim,
    nextAction: (swap: Swap) => nextAction(swap, chainNow.value),
  }
}

export { toHex as swapHex }
