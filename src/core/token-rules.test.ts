import { describe, expect, it } from 'vitest'
import { TOKEN_MAX_SUPPLY, formatAmount, mintableRemaining, parseAmount, validateIssue } from './token-rules'
import type { IssueInput } from './token-rules'

describe('parseAmount / formatAmount', () => {
  it.each([
    ['1', 8, 100_000_000n],
    ['1.5', 8, 150_000_000n],
    ['0.00000001', 8, 1n],
    ['42', 0, 42n],
    ['1.', 2, 100n],
  ])('parses %s with %d decimals', (text, decimals, expected) => {
    expect(parseAmount(text, decimals)).toBe(expected)
  })

  it.each(['', 'abc', '-1', '1.123456789', '1e5', '1,5'])('rejects %j', (text) => {
    expect(parseAmount(text, 8)).toBeNull()
  })

  it('stays exact for huge supplies', () => {
    const text = '57896044618658097711785492504343953926634992332820282019728.792003956564819967'
    expect(parseAmount(text, 18)).toBe(TOKEN_MAX_SUPPLY)
    expect(formatAmount(TOKEN_MAX_SUPPLY, 18)).toBe(text)
  })

  it('formats without trailing zeros', () => {
    expect(formatAmount(150_000_000n, 8)).toBe('1.5')
    expect(formatAmount(100_000_000n, 8)).toBe('1')
    expect(formatAmount(1n, 8)).toBe('0.00000001')
    expect(formatAmount(7n, 0)).toBe('7')
  })
})

const base: IssueInput = {
  name: 'My-Token',
  symbol: 'MYT',
  domain: 'example.com',
  decimals: 8,
  totalSupply: '1000',
  maxSupply: '5000',
  mintable: true,
  burnable: true,
  utility: true,
}

describe('validateIssue', () => {
  it('returns parameters in base units', () => {
    const { errors, params } = validateIssue(base)
    expect(errors).toEqual({})
    expect(params).toMatchObject({ totalSupply: 1000n * 10n ** 8n, maxSupply: 5000n * 10n ** 8n })
  })

  it('makes max equal total for a fixed-supply token', () => {
    const { params } = validateIssue({ ...base, mintable: false, maxSupply: 'ignored' })
    expect(params?.maxSupply).toBe(params?.totalSupply)
  })

  it('allows an empty domain', () => {
    expect(validateIssue({ ...base, domain: '' }).errors).toEqual({})
  })

  it.each([
    [{ name: 'bad name' }, 'name'],
    [{ symbol: 'myt' }, 'symbol'],
    [{ symbol: 'ZNN' }, 'symbol'],
    [{ symbol: 'TOOLONGSYMB' }, 'symbol'],
    [{ domain: 'not a domain' }, 'domain'],
    [{ decimals: 19 }, 'decimals'],
    [{ totalSupply: '1.123456789' }, 'totalSupply'],
    [{ totalSupply: '6000' }, 'totalSupply'],
    [{ maxSupply: '0', totalSupply: '0' }, 'maxSupply'],
    [{ mintable: false, totalSupply: '0' }, 'totalSupply'],
  ] as const)('rejects %o', (patch, field) => {
    const { errors, params } = validateIssue({ ...base, ...patch })
    expect(errors[field]).toBeTruthy()
    expect(params).toBeNull()
  })
})

describe('mintableRemaining', () => {
  it('is max minus total, never negative', () => {
    expect(mintableRemaining(3n, 10n)).toBe(7n)
    expect(mintableRemaining(10n, 10n)).toBe(0n)
  })
})
