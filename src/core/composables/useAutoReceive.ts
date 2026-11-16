import {ref} from 'vue'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {AUTO_RECEIVE_POLL_MS, STORAGE_KEY_AUTO_RECEIVE} from '@/config'
import {AccountService} from '../account-service'
import {AutoReceiver} from '../auto-receiver'
import type {AutoReceiveTarget, PendingReceive} from '../auto-receiver'
import {sessionManager} from '../session-manager'
import {storageService} from '../storage/storage-service'
import {TransactionService} from '../transaction-service'
import {WalletService} from '../wallet-service'
import {trackTransaction} from './useTxTracker'

// Module-level: one auto-receiver per page, whoever calls useAutoReceive().
const enabled = ref(true)
let loaded = false
let timer: ReturnType<typeof setInterval> | null = null
let receiver: AutoReceiver | null = null

async function targets(): Promise<AutoReceiveTarget[]> {
  const { wallets } = await WalletService.getInstance().getSnapshot()
  const transactions = TransactionService.getInstance()
  const result: AutoReceiveTarget[] = []

  for (const wallet of wallets) {
    if (!sessionManager.isUnlocked(wallet.baseAddress)) continue
    // A Ledger would prompt on the device unasked; receive manually instead.
    if (wallet.kind === 'ledger') continue
    for (const account of wallet.accounts) {
      if (account.hidden) continue
      result.push({
        address: account.address,
        receive: async (hash) => {
          // Re-read the key store per receive: the wallet may have been locked meanwhile.
          const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
          if (!keyStore) throw new Error('Wallet is locked')
          const block = await transactions.receiveInBackground(
            hash,
            keyStore.getKeyPair(account.index)
          )
          trackTransaction(receiveLabel(pendingByHash.get(hash)), block)
          pendingByHash.delete(hash)
        },
      })
    }
  }
  return result
}

// Remembers amounts between listing and receiving, for the tracker's toast label.
const pendingByHash = new Map<string, PendingReceive>()

function receiveLabel(tx: PendingReceive | undefined): string {
  return tx?.amount && tx.symbol ? `Receive ${tx.amount} ${tx.symbol}` : 'Receive'
}

async function listUnreceived(address: string): Promise<PendingReceive[]> {
  const list = await AccountService.getInstance().getUnreceivedBlocks(address, 0, 10)
  return (list.list ?? []).map((block) => {
    const tx: PendingReceive = { hash: block.hash.toString() }
    if (block.token) {
      tx.amount = addNumberDecimals(block.amount.toString(), block.token.decimals)
      tx.symbol = block.token.symbol
    }
    if (pendingByHash.size > 500) pendingByHash.clear()
    pendingByHash.set(tx.hash, tx)
    return tx
  })
}

function tick(): void {
  receiver ??= new AutoReceiver({ targets, listUnreceived })
  void receiver.tick()
}

function onWalletStatusChanged(): void {
  // Receive right after an unlock instead of waiting for the next poll.
  if (enabled.value && timer !== null) tick()
}

function startTimer(): void {
  if (timer !== null) return
  timer = setInterval(tick, AUTO_RECEIVE_POLL_MS)
  window.addEventListener('wallet-status-changed', onWalletStatusChanged)
  tick()
}

function stopTimer(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
  window.removeEventListener('wallet-status-changed', onWalletStatusChanged)
}

/**
 * Automatically receive incoming transactions for all unlocked accounts while
 * the wallet is open. A browser can't do this while the page/popup is closed:
 * pending transactions are picked up on the next open and unlock.
 */
export function useAutoReceive() {
  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    const stored = await storageService.get<boolean>(STORAGE_KEY_AUTO_RECEIVE)
    enabled.value = stored ?? true
  }

  /** Load the setting and start polling if it's on. Safe to call more than once. */
  async function start(): Promise<void> {
    await load()
    if (enabled.value) startTimer()
  }

  async function setEnabled(value: boolean): Promise<void> {
    enabled.value = value
    await storageService.set(STORAGE_KEY_AUTO_RECEIVE, value)
    if (value) startTimer()
    else stopTimer()
  }

  return { enabled, start, setEnabled }
}
