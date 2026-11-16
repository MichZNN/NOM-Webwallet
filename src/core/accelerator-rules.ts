/**
 * Accelerator-Z rules, as go-zenon enforces them
 * (vm/constants/embedded.go, vm/embedded/implementation/accelerator.go).
 */

const DECIMALS = 10n ** 8n

export const PROJECT_CREATION_FEE = 1n * DECIMALS // exactly 1 ZNN, not refunded
export const PROJECT_NAME_MAX_BYTES = 30
export const PROJECT_DESCRIPTION_MAX_BYTES = 240
export const PROJECT_ZNN_MAX = 5_000n * DECIMALS
export const PROJECT_QSR_MAX = 50_000n * DECIMALS
export const PROJECT_VOTING_PERIOD_SECONDS = 14 * 24 * 60 * 60
export const VOTE_ACCEPTANCE_THRESHOLD = 33 // percent of active pillars, strictly exceeded

// go-zenon checks the URL with this exact pattern; note that the first host
// label can't contain "-" (www.my-site.com passes, my-site.com does not).
const PROJECT_URL =
  /^([Hh][Tt][Tt][Pp][Ss]?:\/\/)?[a-zA-Z0-9]{2,60}\.[a-zA-Z]{1,6}([-a-zA-Z0-9()@:%_+.~#?&/=]{0,100})$/

export enum ProjectStatus {
  Voting = 0,
  Active = 1,
  Paid = 2,
  Closed = 3,
  Completed = 4,
}

export enum Vote {
  Yes = 0,
  No = 1,
  Abstain = 2,
}

/** Go measures string length in bytes. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export interface MetadataInput {
  name: string
  description: string
  url: string
  znn: bigint | null
  qsr: bigint | null
}

export type MetadataErrors = Partial<Record<keyof MetadataInput, string>>

/** Checks shared by projects and phases (go-zenon checkMetaDataStatic). */
export function metadataErrors(input: MetadataInput): MetadataErrors {
  const errors: MetadataErrors = {}
  const nameBytes = byteLength(input.name)
  if (nameBytes === 0 || nameBytes > PROJECT_NAME_MAX_BYTES) {
    errors.name = `1–${PROJECT_NAME_MAX_BYTES} characters (bytes)`
  }
  const descriptionBytes = byteLength(input.description)
  if (descriptionBytes === 0 || descriptionBytes > PROJECT_DESCRIPTION_MAX_BYTES) {
    errors.description = `1–${PROJECT_DESCRIPTION_MAX_BYTES} characters (bytes)`
  }
  if (!PROJECT_URL.test(input.url)) {
    errors.url = 'A link like https://example.com/page (no "-" in the first part of the domain)'
  }
  if (input.znn === null) errors.znn = 'A ZNN amount with at most 8 decimals'
  else if (input.znn > PROJECT_ZNN_MAX) errors.znn = 'At most 5,000 ZNN'
  if (input.qsr === null) errors.qsr = 'A QSR amount with at most 8 decimals'
  else if (input.qsr > PROJECT_QSR_MAX) errors.qsr = 'At most 50,000 QSR'
  // The chain accepts 0/0, but such a project or phase can never pay anything
  // out, and creating a project still costs 1 ZNN.
  if (!errors.znn && !errors.qsr && input.znn === 0n && input.qsr === 0n) {
    errors.znn = 'Request some ZNN or QSR'
  }
  return errors
}

export interface FundsLike {
  znnFundsNeeded: bigint
  qsrFundsNeeded: bigint
}

export interface PhaseLike extends FundsLike {
  status: number
}

/** A phase on top of the others may not push the total over the project's funds. */
export function phaseFundsError(
  project: FundsLike,
  otherPhases: FundsLike[],
  phase: FundsLike
): string | null {
  const znnUsed = otherPhases.reduce((sum, p) => sum + p.znnFundsNeeded, 0n)
  const qsrUsed = otherPhases.reduce((sum, p) => sum + p.qsrFundsNeeded, 0n)
  if (znnUsed + phase.znnFundsNeeded > project.znnFundsNeeded) {
    return 'More ZNN than the project has left'
  }
  if (qsrUsed + phase.qsrFundsNeeded > project.qsrFundsNeeded) {
    return 'More QSR than the project has left'
  }
  return null
}

/** Paid out so far and still available for new phases, per token. */
export function fundsSummary(project: FundsLike & { phases: PhaseLike[] }) {
  const paid = project.phases.filter((p) => p.status === ProjectStatus.Paid)
  const paidZnn = paid.reduce((sum, p) => sum + p.znnFundsNeeded, 0n)
  const paidQsr = paid.reduce((sum, p) => sum + p.qsrFundsNeeded, 0n)
  const allocatedZnn = project.phases.reduce((sum, p) => sum + p.znnFundsNeeded, 0n)
  const allocatedQsr = project.phases.reduce((sum, p) => sum + p.qsrFundsNeeded, 0n)
  return {
    paidZnn,
    paidQsr,
    unallocatedZnn: project.znnFundsNeeded - allocatedZnn,
    unallocatedQsr: project.qsrFundsNeeded - allocatedQsr,
  }
}

export interface Breakdown {
  yes: number
  no: number
  total: number
}

/** go-zenon checkAcceleratorVotes: more yes than no, and more than 33% of active pillars voted. */
export function voteOutcome(breakdown: Breakdown, activePillars: number) {
  const majority = breakdown.yes > breakdown.no
  const quorum = breakdown.total * 100 > activePillars * VOTE_ACCEPTANCE_THRESHOLD
  // Smallest number of votes that clears the quorum.
  const votesNeeded = Math.floor((activePillars * VOTE_ACCEPTANCE_THRESHOLD) / 100) + 1
  return { majority, quorum, passing: majority && quorum, votesNeeded }
}

/** Unix seconds when a project's voting ends. Phases have no deadline. */
export function votingEndsAt(creationTimestamp: number): number {
  return creationTimestamp + PROJECT_VOTING_PERIOD_SECONDS
}

/**
 * The status the UI should show. A project becomes active at the first
 * accelerator update after it passes within its 14 days; once the 14 days are
 * over it is closed at the next update whatever the votes. The chain only
 * changes the status on that update, so a project can still say "voting" after
 * its period has ended: show that as "voting-ended" (it can no longer pass).
 */
export function displayStatus(
  item: { statusInt: number; creationTimestamp: number },
  isProject: boolean,
  nowSeconds: number
): 'voting' | 'voting-ended' | 'active' | 'paid' | 'closed' | 'completed' {
  switch (item.statusInt) {
    case ProjectStatus.Voting:
      return isProject && nowSeconds > votingEndsAt(item.creationTimestamp) ? 'voting-ended' : 'voting'
    case ProjectStatus.Active:
      return 'active'
    case ProjectStatus.Paid:
      return 'paid'
    case ProjectStatus.Closed:
      return 'closed'
    default:
      return 'completed'
  }
}

/**
 * Whether the owner can add a phase now: the project is active and the last
 * phase (if any) has been paid (go-zenon AddPhaseMethod).
 */
export function canAddPhase(project: { statusInt: number; phases: PhaseLike[] }): boolean {
  if (project.statusInt !== ProjectStatus.Active) return false
  const last = project.phases[project.phases.length - 1]
  return !last || last.status === ProjectStatus.Paid
}

/** The owner can rework the last phase while it is still being voted on. */
export function canUpdatePhase(project: { phases: PhaseLike[] }): boolean {
  const last = project.phases[project.phases.length - 1]
  return !!last && last.status === ProjectStatus.Voting
}
