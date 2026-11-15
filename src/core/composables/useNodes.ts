import {ref, toValue} from 'vue'
import type {MaybeRefOrGetter} from 'vue'
import type {AccountBlockTemplate, PillarInfo, SentinelInfo} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'
import {NodeService} from '../node-service'
import type {QsrDepositContract} from '../node-service'
import {SENTINEL_QSR_AMOUNT, qsrStillNeeded} from '../node-rules'
import {sessionManager} from '../session-manager'
import {TransactionService} from '../transaction-service'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'

export interface PillarSettings {
  name: string
  producer: string
  reward: string
  giveMomentumPercentage: number
  giveDelegatePercentage: number
}

/** Pillar and sentinel state of one account, and the actions to manage them. */
export function useNodes(address: MaybeRefOrGetter<string | null>) {
  const nodes = NodeService.getInstance()
  const transactions = TransactionService.getInstance()

  const pillars = ref<PillarInfo[]>([])
  const pillarQsrCost = ref(0n)
  const pillarDeposit = ref(0n)
  const sentinel = ref<SentinelInfo | null>(null)
  const sentinelDeposit = ref(0n)
  const isLoading = ref(false)
  const isBusy = ref(false)
  const error = ref<string | null>(null)
  let loadId = 0

  async function load(): Promise<void> {
    const addr = toValue(address)
    if (!addr) return
    const id = ++loadId
    isLoading.value = true
    error.value = null
    try {
      const [owned, cost, pDeposit, sInfo, sDeposit] = await Promise.all([
        nodes.getPillarsByOwner(addr),
        nodes.getPillarQsrCost(),
        nodes.getDepositedQsr('pillar', addr),
        nodes.getSentinelByOwner(addr),
        nodes.getDepositedQsr('sentinel', addr),
      ])
      if (id !== loadId) return
      pillars.value = owned
      pillarQsrCost.value = cost
      pillarDeposit.value = pDeposit
      sentinel.value = sInfo
      sentinelDeposit.value = sDeposit
    } catch (err) {
      if (id !== loadId) return
      error.value = err instanceof Error ? err.message : 'Failed to load pillar and sentinel data'
    } finally {
      if (id === loadId) isLoading.value = false
    }
  }

  function keyPairFor(wallet: Wallet) {
    const addr = toValue(address)
    const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
    if (!keyStore) throw new Error('Wallet is locked. Please unlock it first.')
    const account = wallet.accounts.find((a) => a.address === addr)
    if (!account) throw new Error('Account not found')
    return keyStore.getKeyPair(account.index)
  }

  /** Publish blocks in order behind the send overlay, then reload. */
  async function run(
    wallet: Wallet,
    steps: Array<{ label: string; block: () => AccountBlockTemplate }>
  ): Promise<void> {
    if (isBusy.value) throw new Error('Another action is still running')
    isBusy.value = true
    error.value = null
    try {
      const keyPair = keyPairFor(wallet)
      await runActivity(steps[0].label, async ({ setStep }) => {
        for (const [i, step] of steps.entries()) {
          setStep(steps.length > 1 ? `Step ${i + 1}/${steps.length}: ${step.label}` : step.label)
          const sent = await transactions.sendEmbeddedContractBlock(step.block(), keyPair)
          trackTransaction(step.label, sent)
        }
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Transaction failed'
      throw err
    } finally {
      isBusy.value = false
      void load()
    }
  }

  function updatePillar(wallet: Wallet, s: PillarSettings) {
    return run(wallet, [
      {
        label: `Update pillar ${s.name}`,
        block: () =>
          nodes.updatePillar(s.name, s.producer, s.reward, s.giveMomentumPercentage, s.giveDelegatePercentage),
      },
    ])
  }

  function revokePillar(wallet: Wallet, name: string) {
    return run(wallet, [{ label: `Revoke pillar ${name}`, block: () => nodes.revokePillar(name) }])
  }

  /** Deposit the missing QSR (if any), then register; 15,000 ZNN go with the register block. */
  async function registerPillar(wallet: Wallet, s: PillarSettings) {
    if (!(await nodes.isPillarNameAvailable(s.name))) {
      throw new Error(`The name "${s.name}" is already taken`)
    }
    const toDeposit = qsrStillNeeded(pillarQsrCost.value, pillarDeposit.value)
    const steps = []
    if (toDeposit > 0n) {
      steps.push({ label: 'Deposit QSR', block: () => nodes.depositQsr('pillar', toDeposit) })
    }
    steps.push({
      label: `Register pillar ${s.name}`,
      block: () =>
        nodes.registerPillar(s.name, s.producer, s.reward, s.giveMomentumPercentage, s.giveDelegatePercentage),
    })
    return run(wallet, steps)
  }

  /** Deposit the missing QSR (if any), then register; 5,000 ZNN go with the register block. */
  function registerSentinel(wallet: Wallet) {
    const toDeposit = qsrStillNeeded(SENTINEL_QSR_AMOUNT, sentinelDeposit.value)
    const steps = []
    if (toDeposit > 0n) {
      steps.push({ label: 'Deposit QSR', block: () => nodes.depositQsr('sentinel', toDeposit) })
    }
    steps.push({ label: 'Register sentinel', block: () => nodes.registerSentinel() })
    return run(wallet, steps)
  }

  function revokeSentinel(wallet: Wallet) {
    return run(wallet, [{ label: 'Revoke sentinel', block: () => nodes.revokeSentinel() }])
  }

  function withdrawQsr(wallet: Wallet, contract: QsrDepositContract) {
    return run(wallet, [
      { label: `Withdraw deposited QSR (${contract})`, block: () => nodes.withdrawQsr(contract) },
    ])
  }

  return {
    pillars,
    pillarQsrCost,
    pillarDeposit,
    sentinel,
    sentinelDeposit,
    isLoading,
    isBusy,
    error,
    load,
    updatePillar,
    revokePillar,
    registerPillar,
    registerSentinel,
    revokeSentinel,
    withdrawQsr,
  }
}
