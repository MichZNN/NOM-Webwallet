import type { Page } from '@playwright/test'

/**
 * A fake Zenon node for end-to-end tests. Playwright answers the wallet's
 * WebSocket JSON-RPC calls from `handlers`, so flows that publish blocks can
 * run without a network, funds or plasma. Every `ledger.publishRawTransaction`
 * is recorded in `published` for the test to decode and assert on.
 */

export const ZNN = 'zts1znnxxxxxxxxxxxxx9z4ulx'
export const QSR = 'zts1qsrxxxxxxxxxxxxxmrhjll'
const HASH = '0'.repeat(63) + '1'
const SOME_PRODUCER = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'

export interface PublishedBlock {
  toAddress: string
  tokenStandard: string
  amount: string
  /** base64 */
  data: string
}

export type Handler = (params: unknown[]) => unknown

export function token(symbol: string, tokenStandard: string, extra: Record<string, unknown> = {}) {
  return {
    name: symbol,
    symbol,
    domain: 'zenon.network',
    totalSupply: '1',
    maxSupply: '1',
    decimals: 8,
    owner: 'z1qxemdeddedxt0kenxxxxxxxxxxxxxxxxh9amk0',
    tokenStandard,
    isBurnable: true,
    isMintable: true,
    isUtility: true,
    ...extra,
  }
}

export interface MockNodeOptions {
  /** Raw balances by token standard; ZNN and QSR default to 20,000 / 200,000. */
  balances?: Record<string, { token: ReturnType<typeof token>; balance: string }>
  /** Extra or overriding RPC handlers, by method name. */
  handlers?: Record<string, Handler>
  /** Chain id the node reports, by the WebSocket URL the wallet connected to. Default: 1. */
  chainIdFor?: (url: string) => number
}

export class MockNode {
  readonly published: PublishedBlock[] = []
  readonly unhandled = new Set<string>()
  private readonly handlers: Record<string, Handler>
  private readonly chainIdFor: (url: string) => number

  constructor(options: MockNodeOptions = {}) {
    this.chainIdFor = options.chainIdFor ?? (() => 1)
    const balances = {
      [ZNN]: { token: token('ZNN', ZNN), balance: '2000000000000' },
      [QSR]: { token: token('QSR', QSR), balance: '20000000000000' },
      ...options.balances,
    }
    const empty = { count: 0, list: [], more: false }
    this.handlers = {
      'ledger.getFrontierMomentum': () => ({
        version: 1,
        chainIdentifier: 1,
        hash: HASH,
        previousHash: HASH,
        height: 100,
        timestamp: 1_700_000_000,
        data: '',
        content: [],
        changesHash: HASH,
        publicKey: '',
        signature: '',
        producer: SOME_PRODUCER,
      }),
      'ledger.getFrontierAccountBlock': () => null,
      'ledger.getAccountInfoByAddress': ([address]) => ({
        address,
        accountHeight: 5,
        balanceInfoMap: balances,
      }),
      'ledger.getUnreceivedBlocksByAddress': () => empty,
      'ledger.getAccountBlocksByPage': () => empty,
      'ledger.getAccountBlockByHash': () => null,
      // Enough plasma: no PoW, so tests stay fast.
      'embedded.plasma.getRequiredPoWForAccountBlock': () => ({
        availablePlasma: 100_000,
        basePlasma: 21_000,
        requiredDifficulty: 0,
      }),
      'embedded.plasma.get': () => ({ currentPlasma: 100_000, maxPlasma: 100_000, qsrAmount: '0' }),
      'embedded.plasma.getEntriesByAddress': () => ({ qsrAmount: '0', count: 0, list: [] }),
      'embedded.pillar.getAll': () => ({ count: 0, list: [] }),
      'embedded.pillar.getByOwner': () => [],
      'embedded.pillar.getQsrRegistrationCost': () => '15000000000000',
      'embedded.pillar.getDepositedQsr': () => '0',
      'embedded.pillar.getDelegatedPillar': () => null,
      'embedded.pillar.checkNameAvailability': () => true,
      'embedded.sentinel.getByOwner': () => null,
      'embedded.sentinel.getDepositedQsr': () => '0',
      'embedded.token.getByOwner': () => ({ count: 0, list: [] }),
      'embedded.stake.getEntriesByAddress': () => ({ totalAmount: '0', totalWeightedAmount: '0', count: 0, list: [] }),
      'ledger.publishRawTransaction': ([block]) => {
        this.published.push(block as PublishedBlock)
        return null
      },
      ...options.handlers,
    }
  }

  async attach(page: Page): Promise<void> {
    await page.routeWebSocket(/^wss?:\/\/(?!localhost)/, (ws) => {
      const chainIdentifier = this.chainIdFor(ws.url())
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw))
        const reply = (m: { id: number; method: string; params?: unknown[] }) => {
          const handler = this.handlers[m.method]
          if (!handler) this.unhandled.add(m.method)
          let result = handler ? handler(m.params ?? []) : null
          if (m.method === 'ledger.getFrontierMomentum') result = { ...(result as object), chainIdentifier }
          return { jsonrpc: '2.0', id: m.id, result }
        }
        ws.send(JSON.stringify(Array.isArray(message) ? message.map(reply) : reply(message)))
      })
    })
  }
}
