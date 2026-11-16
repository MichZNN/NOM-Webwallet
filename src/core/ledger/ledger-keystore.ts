import type {KeyStore} from 'znn-typescript-sdk'
import {Address} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'
import {LedgerKeyPair} from './ledger-sign'
import {getLedgerApp} from './connection'

/**
 * Stands in for an SDK KeyStore in the session for a Ledger wallet. "Unlocked"
 * here only means the wallet's accounts are usable this session; the keys
 * stay on the device, which is needed at the moment a block is signed.
 */
export class LedgerKeyStore {
  readonly isLedger = true
  private readonly publicKeys = new Map<number, Uint8Array>()

  constructor(wallet: Wallet) {
    for (const account of wallet.accounts) {
      if (account.publicKey) this.publicKeys.set(account.index, Buffer.from(account.publicKey, 'hex'))
    }
  }

  get mnemonic(): string {
    throw new Error('A Ledger wallet has no recovery phrase in this wallet')
  }

  getKeyPair(index = 0): LedgerKeyPair {
    const publicKey = this.publicKeys.get(index)
    if (!publicKey) throw new Error('This account was not added from the Ledger')
    return new LedgerKeyPair(getLedgerApp, index, publicKey)
  }

  getBaseAddress(): Address {
    return this.getKeyPair(0).getAddress()
  }

  /** Typed as an SDK KeyStore for the session manager and its callers. */
  asKeyStore(): KeyStore {
    return this as unknown as KeyStore
  }
}

export function isLedgerWallet(wallet: Pick<Wallet, 'kind'> | null | undefined): boolean {
  return wallet?.kind === 'ledger'
}
