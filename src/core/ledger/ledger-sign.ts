import type {AccountBlockTemplate, KeyPair} from 'znn-typescript-sdk'
import {Address, Hash} from 'znn-typescript-sdk'
import * as ed from '@noble/ed25519'
import type {ZenonLedgerApp} from './ledger-app'
import {transactionBytes} from './tx-bytes'

/**
 * A stand-in for an SDK KeyPair for a Ledger account: address and public key
 * are known, but signing happens on the device. The SDK's prepareBlock signs
 * synchronously, so sign() returns a dummy that signWithLedger() replaces.
 */
export class LedgerKeyPair {
  readonly isLedger = true
  /** Only true while TransactionService prepares a block (see sign()). */
  preparing = false
  constructor(
    readonly app: () => Promise<ZenonLedgerApp>,
    readonly account: number,
    private readonly publicKey: Uint8Array
  ) {}

  getPublicKey(): Buffer {
    return Buffer.from(this.publicKey)
  }

  getAddress(): Address {
    return Address.fromPublicKey(Buffer.from(this.publicKey))
  }

  /**
   * The SDK's prepareBlock needs a synchronous signature; it gets a dummy that
   * signWithLedger() replaces before publishing. Anything else that tries to
   * sign (messages, dApp data) gets an error, never a dummy.
   */
  sign(): Buffer {
    if (!this.preparing) throw new Error('Ledger accounts can only sign transactions')
    return Buffer.alloc(64)
  }

  getPrivateKey(): Buffer {
    throw new Error('Not available on a Ledger account')
  }
}

export function isLedgerKeyPair(k: unknown): k is LedgerKeyPair {
  return typeof k === 'object' && k !== null && (k as { isLedger?: unknown }).isLedger === true
}

/**
 * Replace the dummy signature of a prepared block with one from the Ledger,
 * after checking: the Zenon app is open, the device holds this account, the
 * bytes hash to the block hash, and the returned signature verifies.
 * Nothing is published here, and a block that fails a check never is.
 */
export async function signWithLedger(
  tx: AccountBlockTemplate,
  keyPair: LedgerKeyPair,
  expectedChainId: number
): Promise<AccountBlockTemplate> {
  const app = await keyPair.app()
  await app.ensureZenonApp()
  const devicePub = await app.publicKey(keyPair.account)
  if (Buffer.compare(Buffer.from(devicePub), keyPair.getPublicKey()) !== 0) {
    throw new Error('This Ledger does not hold this account (different device or seed)')
  }
  if (tx.address.toString() !== keyPair.getAddress().toString()) {
    throw new Error('The transaction is not from this Ledger account')
  }
  if (tx.chainIdentifier !== expectedChainId) {
    throw new Error(`Transaction is for chain ${tx.chainIdentifier}, wallet is on ${expectedChainId}`)
  }
  const bytes = transactionBytes(tx)
  const hash = Hash.digest(Buffer.from(bytes))
  if (hash.toString() !== tx.hash.toString()) throw new Error('Transaction hash mismatch; not signing')

  const signature = await app.signTransaction(keyPair.account, bytes)
  if (!(await ed.verifyAsync(signature, hash.getBytes(), devicePub))) {
    throw new Error('The Ledger signature does not verify; not sending')
  }
  tx.signature = Buffer.from(signature)
  return tx
}

export type {KeyPair}
