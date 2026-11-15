/**
 * Pillar and sentinel rules, as go-zenon enforces them
 * (vm/constants/embedded.go, vm/embedded/implementation/{pillars,sentinel}.go).
 * Checked here first so the user gets a clear message instead of a rejected block.
 */

const DECIMALS = 10n ** 8n

export const PILLAR_ZNN_AMOUNT = 15_000n * DECIMALS
export const SENTINEL_ZNN_AMOUNT = 5_000n * DECIMALS
export const SENTINEL_QSR_AMOUNT = 50_000n * DECIMALS
export const PILLAR_NAME_MAX_LENGTH = 40

const PILLAR_NAME = /^([a-zA-Z0-9]+[-._]?)*[a-zA-Z0-9]$/

/** Null when valid, else why not. */
export function pillarNameError(name: string): string | null {
  if (name.length === 0) return 'Enter a name'
  if (name.length > PILLAR_NAME_MAX_LENGTH) {
    return `At most ${PILLAR_NAME_MAX_LENGTH} characters`
  }
  if (!PILLAR_NAME.test(name)) {
    return 'Letters and digits, optionally separated by single "-", "." or "_"'
  }
  return null
}

/** Null when valid, else why not. Percentages are whole numbers 0–100. */
export function percentageError(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    return 'A whole number from 0 to 100'
  }
  return null
}

/** QSR still to deposit before registering, given what is already deposited. */
export function qsrStillNeeded(required: bigint, deposited: bigint): bigint {
  return deposited >= required ? 0n : required - deposited
}

export interface Requirement {
  label: string
  needed: bigint
  available: bigint
  met: boolean
}

/** What registering costs in ZNN and QSR, against the account's balances and deposit. */
export function registrationRequirements(opts: {
  znnRequired: bigint
  qsrRequired: bigint
  qsrDeposited: bigint
  znnBalance: bigint
  qsrBalance: bigint
}): { znn: Requirement; qsr: Requirement; qsrToDeposit: bigint; ready: boolean } {
  const qsrToDeposit = qsrStillNeeded(opts.qsrRequired, opts.qsrDeposited)
  const znn: Requirement = {
    label: 'ZNN',
    needed: opts.znnRequired,
    available: opts.znnBalance,
    met: opts.znnBalance >= opts.znnRequired,
  }
  const qsr: Requirement = {
    label: 'QSR',
    needed: qsrToDeposit,
    available: opts.qsrBalance,
    met: opts.qsrBalance >= qsrToDeposit,
  }
  return { znn, qsr, qsrToDeposit, ready: znn.met && qsr.met }
}

/** "3 days 4 hours", "12 minutes", or "now" for a cooldown in seconds. */
export function formatCooldown(seconds: number): string {
  if (seconds <= 0) return 'now'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (days > 0) return hours > 0 ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day')
  if (hours > 0) return minutes > 0 ? `${plural(hours, 'hour')} ${plural(minutes, 'minute')}` : plural(hours, 'hour')
  return plural(Math.max(1, minutes), 'minute')
}

/**
 * Pillars and sentinels alternate between a lock period and a short revoke
 * window. `isRevocable` says which one is on; `revokeCooldown` is the seconds
 * until it flips.
 */
export function revokeStatus(isRevocable: boolean, revokeCooldown: number): string {
  return isRevocable
    ? `Revocable now; the window closes in ${formatCooldown(revokeCooldown)}`
    : `Revocable in ${formatCooldown(revokeCooldown)}`
}
