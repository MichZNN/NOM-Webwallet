import { describe, expect, it, vi } from 'vitest'
import { toHistoryEntry } from './history'
import type { HistoryBlock } from './history'

const ZNN = { symbol: 'ZNN', decimals: 8, tokenStandard: 'zts1znnxxxxxxxxxxxxx9z4ulx' }

function block(overrides: Partial<HistoryBlock>): HistoryBlock {
  return {
    blockType: 2,
    hash: 'h1',
    height: 7,
    address: 'z1me',
    toAddress: 'z1other',
    amount: '0',
    token: null,
    data: new Uint8Array(),
    confirmationDetail: { momentumTimestamp: 1_700_000_000 },
    pairedAccountBlock: null,
    ...overrides,
  }
}

describe('toHistoryEntry', () => {
  it('maps a user send', () => {
    expect(toHistoryEntry(block({ amount: '150000000', token: ZNN }))).toEqual({
      hash: 'h1',
      height: 7,
      direction: 'out',
      counterparty: 'z1other',
      amount: '150000000',
      symbol: 'ZNN',
      decimals: 8,
      tokenStandard: ZNN.tokenStandard,
      action: null,
      timestamp: 1_700_000_000,
    })
  })

  it('takes a receive block value and sender from its paired send', () => {
    const send = block({ address: 'z1sender', toAddress: 'z1me', amount: '42', token: ZNN })
    const entry = toHistoryEntry(
      block({ blockType: 3, toAddress: 'z1zero', amount: '0', pairedAccountBlock: send })
    )

    expect(entry).toMatchObject({
      direction: 'in',
      counterparty: 'z1sender',
      amount: '42',
      symbol: 'ZNN',
    })
  })

  it('treats contract receives as incoming', () => {
    const payout = block({ blockType: 4, address: 'z1contract', amount: '5', token: ZNN })
    expect(toHistoryEntry(block({ blockType: 5, pairedAccountBlock: payout }))).toMatchObject({
      direction: 'in',
      counterparty: 'z1contract',
      amount: '5',
    })
  })

  it('names embedded contract calls', () => {
    const decode = vi.fn(() => ({ contract: 'Plasma', method: 'fuse' }))
    const entry = toHistoryEntry(block({ data: new Uint8Array([1, 2, 3, 4]) }), decode)

    expect(decode).toHaveBeenCalledWith('z1other', new Uint8Array([1, 2, 3, 4]))
    expect(entry?.action).toBe('Plasma · Fuse')
  })

  it('leaves the action empty for undecodable data', () => {
    const entry = toHistoryEntry(block({ data: new Uint8Array([9]) }), () => null)
    expect(entry?.action).toBeNull()
  })

  it('marks unconfirmed blocks', () => {
    expect(toHistoryEntry(block({ confirmationDetail: null }))?.timestamp).toBeNull()
  })

  it('skips genesis blocks', () => {
    expect(toHistoryEntry(block({ blockType: 1 }))).toBeNull()
  })
})
