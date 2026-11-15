/**
 * ZTS token rules, as go-zenon enforces them (vm/constants/embedded.go,
 * vm/embedded/implementation/token.go). Checked here first so the user gets a
 * clear message instead of a rejected block.
 */

export const TOKEN_ISSUE_FEE = 1n * 10n ** 8n // 1 ZNN
export const TOKEN_NAME_MAX = 40
export const TOKEN_SYMBOL_MAX = 10
export const TOKEN_DOMAIN_MAX = 128
export const TOKEN_MAX_DECIMALS = 18
export const TOKEN_MAX_SUPPLY = 2n ** 255n - 1n

const NAME = /^([a-zA-Z0-9]+[-._]?)*[a-zA-Z0-9]$/
const SYMBOL = /^[A-Z0-9]+$/
const DOMAIN = /^([A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]\.)+[A-Za-z]{2,}$/

/**
 * Parse a decimal amount ("1.5") into base units with exact integer math.
 * Null for anything that isn't a plain non-negative number with at most
 * `decimals` fraction digits.
 */
export function parseAmount(text: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text.trim())
  if (!match) return null
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) return null
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

/** Base units back to a decimal string, without trailing zeros. */
export function formatAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString()
  const s = amount.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, -decimals)
  const fraction = s.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

export interface IssueInput {
  name: string
  symbol: string
  domain: string
  decimals: number
  totalSupply: string
  maxSupply: string
  mintable: boolean
  burnable: boolean
  utility: boolean
}

export interface IssueParams {
  name: string
  symbol: string
  domain: string
  decimals: number
  totalSupply: bigint
  maxSupply: bigint
  mintable: boolean
  burnable: boolean
  utility: boolean
}

/** Field errors (empty when valid) and, when valid, the parameters to issue with. */
export function validateIssue(input: IssueInput): {
  errors: Partial<Record<keyof IssueInput, string>>
  params: IssueParams | null
} {
  const errors: Partial<Record<keyof IssueInput, string>> = {}
  const name = input.name.trim()
  const symbol = input.symbol.trim()
  const domain = input.domain.trim()

  if (!name || name.length > TOKEN_NAME_MAX || !NAME.test(name)) {
    errors.name = `1–${TOKEN_NAME_MAX} letters and digits, optionally separated by single "-", "." or "_"`
  }
  if (!symbol || symbol.length > TOKEN_SYMBOL_MAX || !SYMBOL.test(symbol)) {
    errors.symbol = `1–${TOKEN_SYMBOL_MAX} capital letters and digits`
  } else if (symbol === 'ZNN' || symbol === 'QSR') {
    errors.symbol = 'ZNN and QSR are reserved'
  }
  if (domain && (domain.length > TOKEN_DOMAIN_MAX || !DOMAIN.test(domain))) {
    errors.domain = 'A domain like example.com, or leave empty'
  }

  const decimals = input.decimals
  const decimalsOk = Number.isInteger(decimals) && decimals >= 0 && decimals <= TOKEN_MAX_DECIMALS
  if (!decimalsOk) errors.decimals = `A whole number from 0 to ${TOKEN_MAX_DECIMALS}`

  const total = decimalsOk ? parseAmount(input.totalSupply, decimals) : null
  // A fixed-supply token has max = total, so only the total is asked for.
  const max = input.mintable ? (decimalsOk ? parseAmount(input.maxSupply, decimals) : null) : total

  if (decimalsOk && total === null) errors.totalSupply = `A number with at most ${decimals} decimals`
  if (input.mintable && decimalsOk && max === null) {
    errors.maxSupply = `A number with at most ${decimals} decimals`
  }
  if (total !== null && max !== null) {
    if (max === 0n) errors[input.mintable ? 'maxSupply' : 'totalSupply'] = 'Must be more than 0'
    else if (max > TOKEN_MAX_SUPPLY) errors[input.mintable ? 'maxSupply' : 'totalSupply'] = 'Too large'
    else if (total > max) errors.totalSupply = 'Cannot exceed the max supply'
  }

  const valid = Object.keys(errors).length === 0 && total !== null && max !== null
  return {
    errors,
    params: valid
      ? {
          name,
          symbol,
          domain,
          decimals,
          totalSupply: total,
          maxSupply: max,
          mintable: input.mintable,
          burnable: input.burnable,
          utility: input.utility,
        }
      : null,
  }
}

/** How much can still be minted. */
export function mintableRemaining(totalSupply: bigint, maxSupply: bigint): bigint {
  return maxSupply > totalSupply ? maxSupply - totalSupply : 0n
}
