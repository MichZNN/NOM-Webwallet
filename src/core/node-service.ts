import {
  AccountBlockTemplate,
  Address,
  CommonContract,
  PILLAR_ADDRESS,
  QSR_ZTS,
  SENTINEL_ADDRESS,
} from 'znn-typescript-sdk'
import type {PillarInfo, SentinelInfo} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export type QsrDepositContract = 'pillar' | 'sentinel'

const CONTRACT_ADDRESS = { pillar: PILLAR_ADDRESS, sentinel: SENTINEL_ADDRESS }

/**
 * DepositQsr must carry QSR (go-zenon common.go DepositQsrMethod: the node
 * rejects any other token). znn-typescript-sdk 1.0.5's depositQsr() sends the
 * amount as ZNN, so the block is built here instead.
 */
export function buildDepositQsrBlock(
  contract: QsrDepositContract,
  amount: bigint
): AccountBlockTemplate {
  if (amount <= 0n) throw new Error('Deposit amount must be positive')
  return AccountBlockTemplate.callContract(
    CONTRACT_ADDRESS[contract],
    QSR_ZTS,
    amount,
    CommonContract.abi.encodeFunctionData('DepositQsr', [])
  )
}

/** Reads and block templates for running a pillar or sentinel. */
export class NodeService extends ChainService {
  private static instance: NodeService | null = null

  static getInstance(): NodeService {
    if (!NodeService.instance) {
      NodeService.instance = new NodeService()
    }
    return NodeService.instance
  }

  // --- Pillar ---

  async getPillarsByOwner(owner: string): Promise<PillarInfo[]> {
    await this.ensureInitialized()
    return await this.zenon.embedded.pillar.getByOwner(Address.parse(owner))
  }

  /** QSR to have deposited before registering a pillar (rises with each pillar). */
  async getPillarQsrCost(): Promise<bigint> {
    await this.ensureInitialized()
    return await this.zenon.embedded.pillar.getQsrRegistrationCost()
  }

  async isPillarNameAvailable(name: string): Promise<boolean> {
    await this.ensureInitialized()
    return await this.zenon.embedded.pillar.checkNameAvailability(name)
  }

  registerPillar(
    name: string,
    producer: string,
    reward: string,
    giveMomentumPercentage: number,
    giveDelegatePercentage: number
  ): AccountBlockTemplate {
    return this.zenon.embedded.pillar.register(
      name,
      Address.parse(producer),
      Address.parse(reward),
      giveMomentumPercentage,
      giveDelegatePercentage
    )
  }

  updatePillar(
    name: string,
    producer: string,
    reward: string,
    giveMomentumPercentage: number,
    giveDelegatePercentage: number
  ): AccountBlockTemplate {
    return this.zenon.embedded.pillar.updatePillar(
      name,
      Address.parse(producer),
      Address.parse(reward),
      giveMomentumPercentage,
      giveDelegatePercentage
    )
  }

  revokePillar(name: string): AccountBlockTemplate {
    return this.zenon.embedded.pillar.revoke(name)
  }

  // --- Sentinel ---

  async getSentinelByOwner(owner: string): Promise<SentinelInfo | null> {
    await this.ensureInitialized()
    return await this.zenon.embedded.sentinel.getByOwner(Address.parse(owner))
  }

  registerSentinel(): AccountBlockTemplate {
    return this.zenon.embedded.sentinel.register()
  }

  revokeSentinel(): AccountBlockTemplate {
    return this.zenon.embedded.sentinel.revoke()
  }

  // --- QSR deposits (shared by both contracts) ---

  async getDepositedQsr(contract: QsrDepositContract, owner: string): Promise<bigint> {
    await this.ensureInitialized()
    const api = contract === 'pillar' ? this.zenon.embedded.pillar : this.zenon.embedded.sentinel
    return await api.getDepositedQsr(Address.parse(owner))
  }

  depositQsr(contract: QsrDepositContract, amount: bigint): AccountBlockTemplate {
    return buildDepositQsrBlock(contract, amount)
  }

  withdrawQsr(contract: QsrDepositContract): AccountBlockTemplate {
    const api = contract === 'pillar' ? this.zenon.embedded.pillar : this.zenon.embedded.sentinel
    return api.withdrawQsr()
  }
}
