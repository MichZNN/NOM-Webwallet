import { describe, expect, it } from 'vitest'
import {
  ProjectStatus,
  byteLength,
  canAddPhase,
  canUpdatePhase,
  displayStatus,
  fundsSummary,
  metadataErrors,
  phaseFundsError,
  voteOutcome,
  votingEndsAt,
} from './accelerator-rules'

const ZNN = 10n ** 8n
const valid = {
  name: 'My Project',
  description: 'Builds a thing',
  url: 'https://example.com/plan',
  znn: 100n * ZNN,
  qsr: 1000n * ZNN,
}

describe('metadataErrors', () => {
  it('accepts a valid project', () => {
    expect(metadataErrors(valid)).toEqual({})
  })

  it('counts bytes like Go, not characters', () => {
    expect(byteLength('é')).toBe(2)
    expect(metadataErrors({ ...valid, name: 'é'.repeat(15) }).name).toBeUndefined()
    expect(metadataErrors({ ...valid, name: 'é'.repeat(16) }).name).toBeTruthy()
    expect(metadataErrors({ ...valid, description: 'x'.repeat(241) }).description).toBeTruthy()
    expect(metadataErrors({ ...valid, name: '' }).name).toBeTruthy()
  })

  it.each(['https://example.com', 'http://zenon.network/path?a=1', 'www.my-site.com', 'example.io'])(
    'accepts url %s',
    (url) => expect(metadataErrors({ ...valid, url }).url).toBeUndefined()
  )

  it.each(['my-site.com', 'https://a.com', 'ftp://example.com', '', 'https://example'])(
    'rejects url %j',
    (url) => expect(metadataErrors({ ...valid, url }).url).toBeTruthy()
  )

  it('caps funds and needs at least one non-zero amount', () => {
    expect(metadataErrors({ ...valid, znn: 0n, qsr: 0n }).znn).toBeTruthy()
    expect(metadataErrors({ ...valid, znn: 0n, qsr: 1n })).toEqual({})
    expect(metadataErrors({ ...valid, znn: 5_000n * ZNN, qsr: 50_000n * ZNN })).toEqual({})
    expect(metadataErrors({ ...valid, znn: 5_000n * ZNN + 1n }).znn).toBeTruthy()
    expect(metadataErrors({ ...valid, qsr: 50_000n * ZNN + 1n }).qsr).toBeTruthy()
    expect(metadataErrors({ ...valid, znn: null }).znn).toBeTruthy()
  })
})

describe('phase funds', () => {
  const project = { znnFundsNeeded: 100n, qsrFundsNeeded: 50n }

  it('allows phases up to exactly the project funds', () => {
    expect(phaseFundsError(project, [{ znnFundsNeeded: 60n, qsrFundsNeeded: 0n }], { znnFundsNeeded: 40n, qsrFundsNeeded: 50n })).toBeNull()
  })

  it('rejects going over, per token', () => {
    expect(phaseFundsError(project, [{ znnFundsNeeded: 60n, qsrFundsNeeded: 0n }], { znnFundsNeeded: 41n, qsrFundsNeeded: 0n })).toMatch(/ZNN/)
    expect(phaseFundsError(project, [], { znnFundsNeeded: 0n, qsrFundsNeeded: 51n })).toMatch(/QSR/)
  })

  it('summarises paid and unallocated funds', () => {
    const summary = fundsSummary({
      ...project,
      phases: [
        { znnFundsNeeded: 30n, qsrFundsNeeded: 10n, status: ProjectStatus.Paid },
        { znnFundsNeeded: 20n, qsrFundsNeeded: 5n, status: ProjectStatus.Voting },
      ],
    })
    expect(summary).toEqual({ paidZnn: 30n, paidQsr: 10n, unallocatedZnn: 50n, unallocatedQsr: 35n })
  })
})

describe('voteOutcome', () => {
  it('needs strictly more than 33% of active pillars', () => {
    expect(voteOutcome({ yes: 33, no: 0, total: 33 }, 100).quorum).toBe(false)
    expect(voteOutcome({ yes: 34, no: 0, total: 34 }, 100)).toMatchObject({ quorum: true, passing: true, votesNeeded: 34 })
  })

  it('counts abstain toward the quorum but not the majority', () => {
    expect(voteOutcome({ yes: 10, no: 10, total: 40 }, 100)).toMatchObject({ quorum: true, majority: false, passing: false })
    expect(voteOutcome({ yes: 11, no: 10, total: 40 }, 100).passing).toBe(true)
  })
})

describe('status', () => {
  const created = 1_700_000_000

  it('marks a project as voting-ended after 14 days, phases never', () => {
    const item = { statusInt: ProjectStatus.Voting, creationTimestamp: created }
    expect(displayStatus(item, true, votingEndsAt(created))).toBe('voting')
    expect(displayStatus(item, true, votingEndsAt(created) + 1)).toBe('voting-ended')
    expect(displayStatus(item, false, votingEndsAt(created) + 1)).toBe('voting')
  })

  it('knows when phases can be added or updated', () => {
    const active = { statusInt: ProjectStatus.Active, phases: [] as { status: number; znnFundsNeeded: bigint; qsrFundsNeeded: bigint }[] }
    expect(canAddPhase(active)).toBe(true)
    expect(canUpdatePhase(active)).toBe(false)
    const voting = { ...active, phases: [{ status: ProjectStatus.Voting, znnFundsNeeded: 1n, qsrFundsNeeded: 0n }] }
    expect(canAddPhase(voting)).toBe(false)
    expect(canUpdatePhase(voting)).toBe(true)
    const paid = { ...active, phases: [{ status: ProjectStatus.Paid, znnFundsNeeded: 1n, qsrFundsNeeded: 0n }] }
    expect(canAddPhase(paid)).toBe(true)
    expect(canAddPhase({ ...paid, statusInt: ProjectStatus.Voting })).toBe(false)
  })
})
