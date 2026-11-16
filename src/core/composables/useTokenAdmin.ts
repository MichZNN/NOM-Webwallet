import {ref, toValue} from 'vue'
import type {MaybeRefOrGetter} from 'vue'
import type {AccountBlockTemplate, Token} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'
import {sessionManager} from '../session-manager'
import {TokenAdminService} from '../token-admin-service'
import type {IssueParams} from '../token-rules'
import {TransactionService} from '../transaction-service'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'

/** Tokens the account owns, and the owner actions on them. */
export function useTokenAdmin(address: MaybeRefOrGetter<string | null>) {
  const admin = TokenAdminService.getInstance()
  const transactions = TransactionService.getInstance()

  const tokens = ref<Token[]>([])
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
      const owned = await admin.getOwnedTokens(addr)
      if (id === loadId) tokens.value = owned
    } catch (err) {
      if (id === loadId) error.value = err instanceof Error ? err.message : 'Failed to load tokens'
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

  return {
    tokens,
    isLoading,
    isBusy,
    error,
    load,
    issue: (w: Wallet, p: IssueParams) => send(w, `Issue ${p.symbol}`, () => admin.issue(p)),
    mint: (w: Wallet, t: Token, amount: bigint, receiver: string) =>
      send(w, `Mint ${t.symbol}`, () => admin.mint(t.tokenStandard.toString(), amount, receiver)),
    burn: (w: Wallet, t: Token, amount: bigint) =>
      send(w, `Burn ${t.symbol}`, () => admin.burn(t.tokenStandard.toString(), amount)),
    update: (w: Wallet, t: Token, owner: string, mintable: boolean, burnable: boolean) =>
      send(w, `Update ${t.symbol}`, () =>
        admin.update(t.tokenStandard.toString(), owner, mintable, burnable)
      ),
  }
}
