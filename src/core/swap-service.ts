import {Address, Hash, HTLC_ADDRESS, HtlcContract, TokenStandard} from 'znn-typescript-sdk'
import type {AccountBlock, AccountBlockTemplate} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'
import {HASH_TYPE_SHA3, KEY_MAX_SIZE} from './swap-rules'
import type {HtlcEvent, HtlcLike} from './swap-rules'

const CONTRACT_RECEIVE = 5
const PAGE = 100

const toHex = (data: Uint8Array) => Buffer.from(data).toString('hex')
const strip0x = (v: unknown) => String(v).replace(/^0x/, '').toLowerCase()

/**
 * Decode the HTLC contract's receive block into the call it executed.
 * `executed` = the call produced follow-on blocks (a payout), i.e. it succeeded
 * (Syrius htlc_swaps_handler checks descendantBlocks the same way).
 */
export function decodeHtlcBlock(block: AccountBlock): HtlcEvent | null {
  if (block.blockType !== CONTRACT_RECEIVE || !block.pairedAccountBlock) return null
  const send = block.pairedAccountBlock
  const data = `0x${toHex(send.data)}`
  const executed = (block.descendantBlocks?.length ?? 0) > 0
  const tryDecode = (name: string) => {
    try {
      return HtlcContract.abi.decodeFunctionData(name, data) as unknown[]
    } catch {
      return null
    }
  }
  const created = tryDecode('Create')
  if (created) {
    const [hashLocked, expirationTime, hashType, keyMaxSize, hashLock] = created
    return {
      kind: 'create',
      hash: send.hash.toString(),
      creator: send.address.toString(),
      chainId: send.chainIdentifier,
      zts: send.tokenStandard.toString(),
      symbol: send.token?.symbol ?? '?',
      decimals: send.token?.decimals ?? 8,
      amount: send.amount.toString(),
      hashLocked: String(hashLocked),
      expirationTime: Number(expirationTime),
      hashType: Number(hashType),
      keyMaxSize: Number(keyMaxSize),
      hashLock: strip0x(hashLock),
    }
  }
  const unlocked = tryDecode('Unlock')
  if (unlocked) {
    return { kind: 'unlock', id: strip0x(unlocked[0]), preimage: strip0x(unlocked[1]), executed }
  }
  const reclaimed = tryDecode('Reclaim')
  if (reclaimed) return { kind: 'reclaim', id: strip0x(reclaimed[0]), executed }
  return null
}

/** Reads and block templates for HTLC swaps. */
export class SwapService extends ChainService {
  private static instance: SwapService | null = null

  static getInstance(): SwapService {
    if (!SwapService.instance) {
      SwapService.instance = new SwapService()
    }
    return SwapService.instance
  }

  /** Chain time: the frontier momentum's timestamp (what the contract compares with). */
  async now(): Promise<number> {
    await this.ensureInitialized()
    return (await this.zenon.ledger.getFrontierMomentum()).timestamp
  }

  async chainId(): Promise<number> {
    await this.ensureInitialized()
    return (await this.zenon.ledger.getFrontierMomentum()).chainIdentifier
  }

  /** The HTLC, or null once it is unlocked/reclaimed (or never existed). */
  async getHtlc(id: string): Promise<HtlcLike | null> {
    await this.ensureInitialized()
    try {
      const h = await this.zenon.embedded.htlc.getById(Hash.parse(id))
      return {
        id: h.id.toString(),
        timeLocked: h.timeLocked.toString(),
        hashLocked: h.hashLocked.toString(),
        zts: h.tokenStandard.toString(),
        amount: BigInt(h.amount.toString()),
        expirationTime: h.expirationTime,
        hashType: h.hashType,
        keyMaxSize: h.keyMaxSize,
        hashLock: toHex(h.hashLock),
      }
    } catch {
      return null
    }
  }

  /** Momentum time of a block's confirmation (null while unconfirmed). */
  async confirmedAt(hash: string): Promise<number | null> {
    await this.ensureInitialized()
    const block = await this.zenon.ledger.getAccountBlockByHash(Hash.parse(hash))
    return block?.confirmationDetail?.momentumTimestamp ?? null
  }

  async tokenInfo(zts: string): Promise<{ symbol: string; decimals: number } | null> {
    await this.ensureInitialized()
    const token = await this.zenon.embedded.token.getByZts(TokenStandard.parse(zts))
    return token ? { symbol: token.symbol, decimals: token.decimals } : null
  }

  /** Height of the HTLC contract's account chain. */
  async htlcHeight(): Promise<number> {
    await this.ensureInitialized()
    return (await this.zenon.ledger.getFrontierAccountBlock(HTLC_ADDRESS))?.height ?? 0
  }

  /** HTLC contract events in blocks (fromHeight, toHeight]. */
  async eventsSince(fromHeight: number, toHeight: number): Promise<{ events: HtlcEvent[]; height: number }> {
    await this.ensureInitialized()
    const events: HtlcEvent[] = []
    let height = fromHeight
    while (height < toHeight) {
      const count = Math.min(PAGE, toHeight - height)
      const list = await this.zenon.ledger.getAccountBlocksByHeight(HTLC_ADDRESS, height + 1, count)
      if (!list.list.length) break
      for (const block of list.list) {
        const e = decodeHtlcBlock(block)
        if (e) events.push(e)
        height = Math.max(height, block.height)
      }
    }
    return { events, height }
  }

  /**
   * Whether another HTLC Create used this hashlock since `sinceTime`
   * (Syrius checks the same window). Walks back from the frontier.
   */
  async hashLockReused(hashLock: string, excludeId: string, sinceTime: number): Promise<boolean> {
    await this.ensureInitialized()
    let top = await this.htlcHeight()
    for (let pages = 0; top > 0 && pages < 50; pages++) {
      const start = Math.max(1, top - PAGE + 1)
      const list = await this.zenon.ledger.getAccountBlocksByHeight(HTLC_ADDRESS, start, top - start + 1)
      for (const block of list.list) {
        const e = decodeHtlcBlock(block)
        if (e?.kind === 'create' && e.hashLock === hashLock && e.hash !== excludeId) return true
      }
      const oldest = list.list[0]?.confirmationDetail?.momentumTimestamp ?? 0
      if (oldest && oldest < sinceTime) return false
      top = start - 1
    }
    return false
  }

  create(
    zts: string,
    amount: bigint,
    hashLocked: string,
    expirationTime: number,
    hashLock: string,
    keyMaxSize = KEY_MAX_SIZE
  ): AccountBlockTemplate {
    return this.zenon.embedded.htlc.create(
      TokenStandard.parse(zts),
      amount,
      Address.parse(hashLocked),
      expirationTime,
      HASH_TYPE_SHA3,
      keyMaxSize,
      Buffer.from(hashLock, 'hex')
    )
  }

  unlock(id: string, preimage: Uint8Array): AccountBlockTemplate {
    return this.zenon.embedded.htlc.unlock(Hash.parse(id), preimage)
  }

  reclaim(id: string): AccountBlockTemplate {
    return this.zenon.embedded.htlc.reclaim(Hash.parse(id))
  }
}
