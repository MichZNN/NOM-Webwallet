import type {AccountBlockTemplate} from 'znn-typescript-sdk'
import {Hash} from 'znn-typescript-sdk'
import {TX_LENGTH} from './apdu'

/** Big-endian unsigned integer of `size` bytes. */
function uint(value: bigint | number | string, size: number): Uint8Array {
  let v = BigInt(value)
  if (v < 0n) throw new Error('Negative value')
  const out = new Uint8Array(size)
  for (let i = size - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  if (v !== 0n) throw new Error('Value too large')
  return out
}

/**
 * The 306-byte serialisation (TX_LEN in the app's src/transaction/tx_types.h) of a prepared block that the Ledger app parses
 * and signs (doc/TRANSACTION.md), which is also the preimage of the block hash
 * (znn-typescript-sdk utilities/block.js getTxHash). Data goes in as its hash.
 */
export function transactionBytes(tx: AccountBlockTemplate): Uint8Array {
  const nonce = Buffer.from(tx.nonce || '', 'hex')
  if (nonce.length > 8) throw new Error('Invalid nonce')
  const parts = [
    uint(tx.version, 8),
    uint(tx.chainIdentifier, 8),
    uint(tx.blockType, 8),
    tx.previousHash.getBytes(),
    uint(tx.height, 8),
    tx.momentumAcknowledged.getBytes(),
    tx.address.getBytes(),
    tx.toAddress.getBytes(),
    uint(tx.amount.toString(), 32),
    tx.tokenStandard.getBytes(),
    tx.fromBlockHash.getBytes(),
    Hash.digest(Buffer.from([])).getBytes(), // descendant blocks: none
    Hash.digest(Buffer.from(tx.data)).getBytes(),
    uint(tx.fusedPlasma, 8),
    uint(tx.difficulty, 8),
    uint(BigInt(`0x${nonce.toString('hex') || '0'}`), 8),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  if (out.length !== TX_LENGTH) throw new Error(`Transaction serialised to ${out.length} bytes`)
  return out
}
