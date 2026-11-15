import { describe, expect, it } from 'vitest'
import {
  formatCooldown,
  percentageError,
  pillarNameError,
  qsrStillNeeded,
  registrationRequirements,
  revokeStatus,
} from './node-rules'

describe('pillarNameError', () => {
  it.each(['Pillar1', 'my-pillar', 'a.b_c', 'X'])('accepts %s', (name) => {
    expect(pillarNameError(name)).toBeNull()
  })

  it.each(['', '-pillar', 'pillar-', 'pil--lar', 'pil lar', 'pillär', 'a'.repeat(41)])(
    'rejects %j',
    (name) => {
      expect(pillarNameError(name)).not.toBeNull()
    }
  )
})

describe('percentageError', () => {
  it.each([0, 50, 100])('accepts %d', (n) => expect(percentageError(n)).toBeNull())
  it.each([-1, 101, 2.5, Number.NaN])('rejects %d', (n) => expect(percentageError(n)).not.toBeNull())
})

describe('registration costs', () => {
  it('only asks for the QSR not yet deposited', () => {
    expect(qsrStillNeeded(150n, 0n)).toBe(150n)
    expect(qsrStillNeeded(150n, 100n)).toBe(50n)
    expect(qsrStillNeeded(150n, 200n)).toBe(0n)
  })

  it('checks balances against what is still needed', () => {
    const r = registrationRequirements({
      znnRequired: 15n,
      qsrRequired: 150n,
      qsrDeposited: 100n,
      znnBalance: 20n,
      qsrBalance: 40n,
    })
    expect(r.qsrToDeposit).toBe(50n)
    expect(r.znn.met).toBe(true)
    expect(r.qsr.met).toBe(false)
    expect(r.ready).toBe(false)
  })
})

describe('cooldowns', () => {
  it('formats durations', () => {
    expect(formatCooldown(0)).toBe('now')
    expect(formatCooldown(30)).toBe('1 minute')
    expect(formatCooldown(3_600 * 2 + 60 * 5)).toBe('2 hours 5 minutes')
    expect(formatCooldown(86_400 * 3 + 3_600)).toBe('3 days 1 hour')
  })

  it('describes both phases', () => {
    expect(revokeStatus(true, 3_600)).toBe('Revocable now; the window closes in 1 hour')
    expect(revokeStatus(false, 86_400)).toBe('Revocable in 1 day')
  })
})
