import {
  ACCELERATOR_ADDRESS,
  AcceleratorContract,
  AccountBlockTemplate,
  Hash,
  TokenStandard,
  ZNN_ZTS,
} from 'znn-typescript-sdk'
import type {Project} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'
import {PROJECT_CREATION_FEE} from './accelerator-rules'
import type {Vote} from './accelerator-rules'

export interface ProjectMetadata {
  name: string
  description: string
  url: string
  znn: bigint
  qsr: bigint
}

/**
 * CreateProject must carry exactly 1 ZNN (go-zenon accelerator.go
 * CreateProjectMethod). znn-typescript-sdk 1.0.5 sends 10 base units, so the
 * block is built here with the SDK's ABI encoding.
 */
export function buildCreateProjectBlock(m: ProjectMetadata): AccountBlockTemplate {
  return AccountBlockTemplate.callContract(
    ACCELERATOR_ADDRESS,
    ZNN_ZTS,
    PROJECT_CREATION_FEE,
    AcceleratorContract.abi.encodeFunctionData('CreateProject', [
      m.name,
      m.description,
      m.url,
      m.znn.toString(),
      m.qsr.toString(),
    ])
  )
}

/** Reads and block templates for Accelerator-Z. */
export class AcceleratorService extends ChainService {
  private static instance: AcceleratorService | null = null

  static getInstance(): AcceleratorService {
    if (!AcceleratorService.instance) {
      AcceleratorService.instance = new AcceleratorService()
    }
    return AcceleratorService.instance
  }

  /** Projects with their phases and votes, most recently updated first. */
  async getProjects(pageIndex = 0, pageSize = 50): Promise<{ count: number; list: Project[] }> {
    await this.ensureInitialized()
    const result = await this.zenon.embedded.accelerator.getAll(pageIndex, pageSize)
    return { count: result.count, list: result.list }
  }

  /** ZNN and QSR the accelerator contract holds; a phase is only paid when both cover it. */
  async getContractBalances(): Promise<{ znn: bigint; qsr: bigint }> {
    await this.ensureInitialized()
    const info = await this.zenon.ledger.getAccountInfoByAddress(ACCELERATOR_ADDRESS)
    const balance = (symbol: string) => {
      const entry = Object.values(info?.balanceInfoMap ?? {}).find((b) => b.token.symbol === symbol)
      return entry ? BigInt(entry.balance.toString()) : 0n
    }
    return { znn: balance('ZNN'), qsr: balance('QSR') }
  }

  /** Active pillars: the base of the 33% quorum. */
  async getActivePillarCount(): Promise<number> {
    await this.ensureInitialized()
    return (await this.zenon.embedded.pillar.getAll(0, 1)).count
  }

  /** This pillar's vote on each id (null where it hasn't voted). */
  async getPillarVotes(pillarName: string, ids: string[]): Promise<Map<string, number>> {
    await this.ensureInitialized()
    if (ids.length === 0) return new Map()
    const votes = await this.zenon.embedded.accelerator.getPillarVotes(pillarName, ids)
    const result = new Map<string, number>()
    votes.forEach((v, i) => {
      if (v) result.set(ids[i], v.vote)
    })
    return result
  }

  createProject(m: ProjectMetadata): AccountBlockTemplate {
    return buildCreateProjectBlock(m)
  }

  addPhase(projectId: string, m: ProjectMetadata): AccountBlockTemplate {
    return this.zenon.embedded.accelerator.addPhase(Hash.parse(projectId), m.name, m.description, m.url, m.znn, m.qsr)
  }

  /** Replaces the project's last phase (and resets its votes). Takes the project id. */
  updatePhase(projectId: string, m: ProjectMetadata): AccountBlockTemplate {
    return this.zenon.embedded.accelerator.updatePhase(Hash.parse(projectId), m.name, m.description, m.url, m.znn, m.qsr)
  }

  donate(amount: bigint, zts: string): AccountBlockTemplate {
    return this.zenon.embedded.accelerator.donate(amount, TokenStandard.parse(zts))
  }

  /** Vote on a project or phase as the owner of `pillarName`. */
  vote(id: string, pillarName: string, vote: Vote): AccountBlockTemplate {
    return this.zenon.embedded.accelerator.voteByName(Hash.parse(id), pillarName, vote)
  }
}
