/**
 * APDU encoding for the Zenon Ledger app (github.com/HyperCore-One/ledger-app-zenon,
 * src/apdu/dispatcher.{c,h}; same as znn_ledger_dart's ledger_transport.dart).
 * Note: the app's doc/COMMANDS.md has the P2 flags of SIGN_TX the wrong way
 * round; the source (P2_MORE = 0x80, P2_LAST = 0x00) is what counts.
 */

export const CLA = 0xe0
export const INS_GET_VERSION = 0x03
export const INS_GET_APP_NAME = 0x04
export const INS_GET_PUBLIC_KEY = 0x05
export const INS_SIGN_TX = 0x06
export const P1_CONFIRM = 0x01
export const P2_LAST = 0x00
export const P2_MORE = 0x80
export const P1_MAX = 0x03
export const CHUNK_SIZE = 255
export const APP_NAME = 'Zenon'
/** The raw transaction the app signs: the preimage of the transaction hash. */
export const TX_LENGTH = 306

const HARDENED = 0x80000000

export const SW_OK = 0x9000
const STATUS_MESSAGES: Record<number, string> = {
  0x6985: 'Rejected on the Ledger',
  0x6a86: 'The Ledger refused the request (P1/P2)',
  0x6a87: 'The Ledger refused the request (data length)',
  0x6d00: 'Open the Zenon app on your Ledger',
  0x6e00: 'Open the Zenon app on your Ledger',
  0x6e01: 'Open the Zenon app on your Ledger',
  0x5515: 'Unlock your Ledger',
  0xb004: 'The Ledger rejected the transaction length',
  0xb005: 'The Ledger could not parse the transaction',
  0xb006: 'The Ledger could not hash the transaction',
  0xb007: 'The Ledger is in a bad state; try again',
  0xb008: 'The Ledger could not sign the transaction',
}

export class LedgerStatusError extends Error {
  constructor(readonly statusWord: number) {
    super(STATUS_MESSAGES[statusWord] ?? `Ledger error 0x${statusWord.toString(16).padStart(4, '0')}`)
    this.name = 'LedgerStatusError'
  }
  get rejected(): boolean {
    return this.statusWord === 0x6985
  }
}

export function apdu(ins: number, p1: number, p2: number, data: Uint8Array = new Uint8Array()): Uint8Array {
  if (data.length > 255) throw new Error('APDU data too long')
  return Uint8Array.from([CLA, ins, p1, p2, data.length, ...data])
}

/** BIP32 path m/44'/73404'/account' as the app expects it: count, then big-endian u32s. */
export function encodePath(account: number): Uint8Array {
  if (!Number.isInteger(account) || account < 0 || account >= HARDENED) throw new Error('Invalid account index')
  const out = new Uint8Array(1 + 3 * 4)
  const view = new DataView(out.buffer)
  out[0] = 3
  ;[44, 73404, account].forEach((v, i) => view.setUint32(1 + i * 4, (v | HARDENED) >>> 0, false))
  return out
}

export const getVersionApdu = () => apdu(INS_GET_VERSION, 0, 0)
export const getAppNameApdu = () => apdu(INS_GET_APP_NAME, 0, 0)
export const getPublicKeyApdu = (account: number, confirm: boolean) =>
  apdu(INS_GET_PUBLIC_KEY, confirm ? P1_CONFIRM : 0, 0, encodePath(account))

/** The APDU sequence for SIGN_TX: the path, then the transaction in 255-byte chunks. */
export function signTxApdus(account: number, tx: Uint8Array): Uint8Array[] {
  if (tx.length !== TX_LENGTH) throw new Error(`A transaction is ${TX_LENGTH} bytes, got ${tx.length}`)
  const out = [apdu(INS_SIGN_TX, 0, P2_MORE, encodePath(account))]
  for (let offset = 0, p1 = 1; offset < tx.length; offset += CHUNK_SIZE, p1++) {
    if (p1 > P1_MAX) throw new Error('Transaction too long for the Ledger')
    const chunk = tx.subarray(offset, offset + CHUNK_SIZE)
    const last = offset + CHUNK_SIZE >= tx.length
    out.push(apdu(INS_SIGN_TX, p1, last ? P2_LAST : P2_MORE, chunk))
  }
  return out
}

/** Split a response into data and status word; throws on a non-OK status. */
export function unwrap(response: Uint8Array): Uint8Array {
  if (response.length < 2) throw new Error('Empty response from the Ledger')
  const sw = (response[response.length - 2] << 8) | response[response.length - 1]
  if (sw !== SW_OK) throw new LedgerStatusError(sw)
  return response.subarray(0, response.length - 2)
}

/** `[len, bytes...]` responses (public key: 32, signature: 64). */
export function lengthPrefixed(data: Uint8Array, expected: number): Uint8Array {
  if (data[0] !== expected || data.length < 1 + expected) {
    throw new Error('Unexpected response length from the Ledger')
  }
  return data.slice(1, 1 + expected)
}
