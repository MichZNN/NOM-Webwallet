import {getCurrentScope, onScopeDispose, ref, toValue} from 'vue'
import type {MaybeRefOrGetter} from 'vue'
import type {AccountBlockTemplate, PillarInfo, Project} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'
import {AcceleratorService} from '../accelerator-service'
import type {ProjectMetadata} from '../accelerator-service'
import type {Vote} from '../accelerator-rules'
import {NodeService} from '../node-service'
import {sessionManager} from '../session-manager'
import {TransactionService} from '../transaction-service'
import {runActivity} from './useActivity'
import {onTxProgress, trackTransaction} from './useTxTracker'

/** Page size when reading all projects; go-zenon allows up to 1024. */
const PAGE_SIZE = 200

/** Accelerator-Z projects, plus what the active account can do with them. */
export function useAccelerator(address: MaybeRefOrGetter<string | null>) {
  const service = AcceleratorService.getInstance()
  const transactions = TransactionService.getInstance()

  const projects = ref<Project[]>([])
  const count = ref(0)
  const balances = ref<{ znn: bigint; qsr: bigint }>({ znn: 0n, qsr: 0n })
  const activePillars = ref(0)
  /** Pillars the active account owns, so it may vote with them. */
  const ownedPillars = ref<PillarInfo[]>([])
  /** Votes of the selected pillar, by project/phase id. */
  const votes = ref(new Map<string, number>())
  const votingPillar = ref<string | null>(null)
  const isLoading = ref(false)
  /** A load finished without error (so an empty pillar list means "owns none"). */
  const loaded = ref(false)
  const isBusy = ref(false)
  const error = ref<string | null>(null)
  let loadId = 0
  let votesId = 0

  async function loadVotes(): Promise<void> {
    const id = ++votesId
    const name = votingPillar.value
    if (!name) {
      votes.value = new Map()
      return
    }
    const ids = projects.value.flatMap((p) => [p.id.toString(), ...p.phases.map((ph) => ph.id.toString())])
    const result = await service.getPillarVotes(name, ids)
    // A later pillar/account switch or reload wins over this response.
    if (id === votesId) votes.value = result
  }

  /** Every project (filters and "Mine" must see all of them, not one page). */
  async function getAllProjects(): Promise<{ count: number; list: Project[] }> {
    const list: Project[] = []
    for (let pageIndex = 0; ; pageIndex++) {
      const result = await service.getProjects(pageIndex, PAGE_SIZE)
      list.push(...result.list)
      if (result.list.length < PAGE_SIZE || list.length >= result.count) return { count: result.count, list }
    }
  }

  async function load(): Promise<void> {
    const id = ++loadId
    isLoading.value = true
    error.value = null
    try {
      const addr = toValue(address)
      const [list, contract, pillarCount, owned] = await Promise.all([
        getAllProjects(),
        service.getContractBalances(),
        service.getActivePillarCount(),
        addr ? NodeService.getInstance().getPillarsByOwner(addr) : Promise.resolve([]),
      ])
      if (id !== loadId) return
      loaded.value = true
      projects.value = list.list
      count.value = list.count
      balances.value = contract
      activePillars.value = pillarCount
      ownedPillars.value = owned
      if (!owned.some((p) => p.name === votingPillar.value)) votingPillar.value = owned[0]?.name ?? null
      await loadVotes()
    } catch (err) {
      if (id === loadId) error.value = err instanceof Error ? err.message : 'Failed to load Accelerator-Z'
    } finally {
      if (id === loadId) isLoading.value = false
    }
  }

  async function send(wallet: Wallet, label: string, block: () => AccountBlockTemplate) {
    if (isBusy.value) throw new Error('Another action is still running')
    const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
    if (!keyStore) throw new Error('Wallet is locked. Please unlock it first.')
    const account = wallet.accounts.find((a) => a.address === toValue(address))
    if (!account) throw new Error('Account not found')

    isBusy.value = true
    try {
      await runActivity(label, async () => {
        const sent = await transactions.sendEmbeddedContractBlock(block(), keyStore.getKeyPair(account.index))
        trackTransaction(label, sent)
      })
    } finally {
      isBusy.value = false
      void load()
    }
  }

  // Reload once our blocks are confirmed: right after publishing, the contract
  // hasn't processed them yet, so votes and new projects would look stale.
  if (getCurrentScope()) {
    const stop = onTxProgress((tx) => {
      if (tx.address === toValue(address) && tx.label.match(/^(Vote|Create project|Add phase|Update phase|Donate)/)) {
        void load()
      }
    })
    onScopeDispose(stop)
  }

  return {
    projects,
    count,
    balances,
    activePillars,
    ownedPillars,
    votes,
    votingPillar,
    isLoading,
    loaded,
    isBusy,
    error,
    load,
    loadVotes,
    createProject: (w: Wallet, m: ProjectMetadata) =>
      send(w, `Create project ${m.name}`, () => service.createProject(m)),
    addPhase: (w: Wallet, projectId: string, m: ProjectMetadata) =>
      send(w, `Add phase ${m.name}`, () => service.addPhase(projectId, m)),
    updatePhase: (w: Wallet, projectId: string, m: ProjectMetadata) =>
      send(w, `Update phase ${m.name}`, () => service.updatePhase(projectId, m)),
    donate: (w: Wallet, amount: bigint, zts: string, symbol: string) =>
      send(w, `Donate ${symbol}`, () => service.donate(amount, zts)),
    vote: (w: Wallet, id: string, pillarName: string, vote: Vote, label: string) =>
      send(w, label, () => service.vote(id, pillarName, vote)),
  }
}
