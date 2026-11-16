import {Crypto} from 'znn-typescript-sdk'
import * as ed from '@noble/ed25519'
import {APP_NAME, CLA, INS_GET_APP_NAME, INS_GET_PUBLIC_KEY, INS_GET_VERSION, INS_SIGN_TX, P1_MAX, P2_LAST, P2_MORE, TX_LENGTH} from './apdu'
import type {LedgerTransport} from './ledger-app'

const sw = (code: number, data: Uint8Array = new Uint8Array()) =>
  Uint8Array.from([...data, code >> 8, code & 0xff])

/**
 * A software stand-in for the Zenon Ledger app, following its dispatcher and
 * SIGN_TX handler (src/apdu/dispatcher.c, src/handler/sign_tx.c): same APDU
 * rules, same chunk state machine, and real Ed25519 signatures from a seed,
 * with keys derived from the path the APDU carries. For tests only.
 */
export class FakeZenonLedger implements LedgerTransport {
  /** Decide each signature like the user would; default approves. */
  approve: () => boolean | Promise<boolean> = () => true
  appName = APP_NAME
  readonly signed: Uint8Array[] = []
  private chunks: Uint8Array[] | null = null
  private path = ''
  private nextP1 = 0

  constructor(private readonly seed: string) {}

  private key(path: string): Uint8Array {
    return Crypto.deriveKey(path, this.seed)
  }

  private parsePath(data: Uint8Array): string | null {
    if (data[0] !== 3 || data.length !== 13) return null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const parts = [0, 1, 2].map((i) => view.getUint32(1 + i * 4, false))
    if (!parts.every((p) => p >= 0x80000000)) return null
    return `m/${parts.map((p) => `${p - 0x80000000}'`).join('/')}`
  }

  async exchange(apdu: Uint8Array): Promise<Uint8Array> {
    const [cla, ins, p1, p2, lc] = apdu
    const data = apdu.subarray(5, 5 + lc)
    if (cla !== CLA) return sw(0x6e00)
    if (this.appName !== APP_NAME) return sw(0x6e01)
    switch (ins) {
      case INS_GET_VERSION:
        return sw(0x9000, Uint8Array.from([1, 0, 0]))
      case INS_GET_APP_NAME:
        return sw(0x9000, new TextEncoder().encode(APP_NAME))
      case INS_GET_PUBLIC_KEY: {
        const path = this.parsePath(data)
        if (!path) return sw(0x6a87)
        const pub = await ed.getPublicKeyAsync(this.key(path))
        return sw(0x9000, Uint8Array.from([32, ...pub]))
      }
      case INS_SIGN_TX: {
        if ((p1 === 0 && p2 !== P2_MORE) || p1 > P1_MAX || (p2 !== P2_LAST && p2 !== P2_MORE)) return sw(0x6a86)
        if (p1 === 0) {
          const path = this.parsePath(data)
          if (!path) return sw(0x6a87)
          this.path = path
          this.chunks = []
          this.nextP1 = 1
          return sw(0x9000)
        }
        if (!this.chunks || p1 !== this.nextP1) return sw(0xb007)
        this.chunks.push(Uint8Array.from(data))
        this.nextP1++
        if (p2 === P2_MORE) return sw(0x9000)
        const tx = Uint8Array.from(this.chunks.flatMap((c) => [...c]))
        this.chunks = null
        if (tx.length !== TX_LENGTH) return sw(0xb004)
        if (!(await this.approve())) return sw(0x6985)
        // The app signs the SHA3-256 hash of the transaction.
        const {Hash} = await import('znn-typescript-sdk')
        const hash = Hash.digest(Buffer.from(tx)).getBytes()
        const signature = await ed.signAsync(hash, this.key(this.path))
        this.signed.push(tx)
        return sw(0x9000, Uint8Array.from([64, ...signature]))
      }
      default:
        return sw(0x6d00)
    }
  }

  async close(): Promise<void> {}
}
