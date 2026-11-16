import {
  AccountBlock,
  AccountBlockTemplate,
  Address,
  Hash,
  KeyPair,
  TokenStandard,
} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'
import {createSerialQueue} from './serial-queue'
import {holdSendLock} from './send-status'
import {withTimeout} from './with-timeout'
import {SEND_TIMEOUT_MS} from '@/config'
import {isGeneratingPow} from './pow-status'
import {Zenon} from 'znn-typescript-sdk'
import {isLedgerKeyPair, signWithLedger} from './ledger/ledger-sign'
import {LedgerStatusError} from './ledger/apdu'
import {disconnectLedger} from './ledger/connection'
import type {LedgerKeyPair} from './ledger/ledger-sign'

const SEND_TIMEOUT_MESSAGE =
  'The outcome is unknown: the node did not respond in time and this transaction may still go through. Check your account history before sending again.'

export class TransactionService extends ChainService {
  private static instance: TransactionService | null = null

  // Sends from one account must not overlap: two concurrent sends autofill the
  // same frontier and the second publish fails.
  private readonly sendQueue = createSerialQueue()

  static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService()
    }
    return TransactionService.instance
  }

  // Send a transaction
  async sendTransaction(
    recipientAddress: string,
    zts: string,
    amount: bigint,
    keyPair: KeyPair
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const recipient = Address.parse(recipientAddress)
    const tokenStandard = TokenStandard.parse(zts)
    const block = AccountBlockTemplate.send(recipient, tokenStandard, amount)

    return this.publish(block, keyPair)
  }

  // Receive a transaction
  async receiveTransaction(blockHash: string, keyPair: KeyPair): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const hash = Hash.parse(blockHash)
    const receiveBlock = AccountBlockTemplate.receive(hash)

    return this.publish(receiveBlock, keyPair)
  }

  // Receive without the send overlay (auto-receive). Still goes through the
  // send queue, so it never races a user's send on the same frontier.
  async receiveInBackground(blockHash: string, keyPair: KeyPair): Promise<AccountBlockTemplate> {
    // A Ledger would prompt on the device unasked: background sends are off for it.
    if (isLedgerKeyPair(keyPair as unknown)) throw new Error('Background signing is not available for Ledger accounts')
    await this.ensureInitialized()
    const receiveBlock = AccountBlockTemplate.receive(Hash.parse(blockHash))

    return this.publish(receiveBlock, keyPair, undefined, false)
  }

  // Embedded contract call without the send overlay (swap auto-unlock). Same
  // queue as every other send.
  async sendEmbeddedInBackground(block: AccountBlockTemplate, keyPair: KeyPair): Promise<AccountBlockTemplate> {
    if (isLedgerKeyPair(keyPair as unknown)) throw new Error('Background signing is not available for Ledger accounts')
    await this.ensureInitialized()
    return this.publish(block, keyPair, undefined, false)
  }

  // Send an embedded contract block (for rewards, staking, etc).
  // `beforePublish` runs after PoW and signing, right before the block is
  // published. Throwing from it stops the publish.
  async sendEmbeddedContractBlock(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish?: () => void
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    return this.publish(block, keyPair, beforePublish)
  }

  // Read a block by hash. Bypasses the send queue and lock: reads never hold the overlay.
  async getAccountBlock(hash: string): Promise<AccountBlock | null> {
    await this.ensureInitialized()
    return this.zenon.ledger.getAccountBlockByHash(Hash.parse(hash))
  }

  // Queue a send behind earlier ones and bound it by SEND_TIMEOUT_MS, which
  // starts when the send leaves the queue. The abandoned send is not cancelled.
  private publish(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish?: () => void,
    showOverlay = true
  ): Promise<AccountBlockTemplate> {
    const ledgerKeyPair = isLedgerKeyPair(keyPair as unknown) ? (keyPair as unknown as LedgerKeyPair) : null
    const ledger = ledgerKeyPair !== null
    const send = () =>
      this.sendQueue(() => {
        let gaveUp = false
        // Where a Ledger send is, for an honest timeout message.
        let stage: 'preparing' | 'device' | 'publishing' = 'preparing'
        const work = (async () => {
          await this.ensureInitialized()
          if (ledgerKeyPair) ledgerKeyPair.preparing = true
          let prepared: AccountBlockTemplate
          try {
            prepared = await this.zenon.prepareBlock(block, keyPair)
          } finally {
            if (ledgerKeyPair) ledgerKeyPair.preparing = false
          }
          // Ledger accounts: prepareBlock put in a dummy signature; get the
          // real one from the device (with all checks) before publishing.
          if (ledgerKeyPair) {
            stage = 'device'
            try {
              prepared = await signWithLedger(prepared, ledgerKeyPair, Zenon.getChainIdentifier())
            } catch (err) {
              // A rejection keeps the connection; anything else (unplugged,
              // locked, stuck) drops it so the next attempt reconnects.
              if (!(err instanceof LedgerStatusError)) void disconnectLedger()
              throw err
            }
            // Approved on the device after we reported a timeout: don't send.
            if (gaveUp) throw new Error('Signed after the time limit; not sent')
          }
          beforePublish?.()
          stage = 'publishing'
          return this.zenon.ledger.publishRawTransaction(prepared)
        })()
        // PoW time doesn't count: without plasma a contract call can need minutes
        // of it, and that is this device working, not the node being slow.
        return withTimeout(work, SEND_TIMEOUT_MS, SEND_TIMEOUT_MESSAGE, () => isGeneratingPow.value).catch((err) => {
          gaveUp = true
          if (ledger && err instanceof Error && err.message === SEND_TIMEOUT_MESSAGE && stage !== 'publishing') {
            // The device prompt is abandoned; drop the connection so the stale
            // request doesn't block the next one. Nothing was published.
            void disconnectLedger()
            throw new Error('Not confirmed on the Ledger in time; nothing was sent')
          }
          throw err
        })
      })
    return showOverlay ? holdSendLock(send) : send()
  }
}
