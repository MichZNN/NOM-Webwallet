import {
  APP_NAME,
  getAppNameApdu,
  getPublicKeyApdu,
  getVersionApdu,
  lengthPrefixed,
  signTxApdus,
  unwrap,
} from './apdu'
import {createSerialQueue} from '../serial-queue'

/** Anything that can exchange one APDU with a device (WebHID, a test fake). */
export interface LedgerTransport {
  exchange(apdu: Uint8Array): Promise<Uint8Array>
  close(): Promise<void>
}

/**
 * The Zenon app on a Ledger. Every command sequence runs alone: the device
 * keeps signing state between the SIGN_TX APDUs, so they must never interleave.
 */
export class ZenonLedgerApp {
  private readonly queue = createSerialQueue()

  constructor(private readonly transport: LedgerTransport) {}

  private run<T>(task: () => Promise<T>): Promise<T> {
    return this.queue(task)
  }

  private async send(apdu: Uint8Array): Promise<Uint8Array> {
    return unwrap(await this.transport.exchange(apdu))
  }

  appName(): Promise<string> {
    return this.run(async () => new TextDecoder().decode(await this.send(getAppNameApdu())))
  }

  version(): Promise<string> {
    return this.run(async () => {
      const v = await this.send(getVersionApdu())
      if (v.length < 3) throw new Error('Unexpected version response from the Ledger')
      return `${v[0]}.${v[1]}.${v[2]}`
    })
  }

  /** Throws unless the Zenon app is open. */
  async ensureZenonApp(): Promise<void> {
    const name = await this.appName()
    if (name !== APP_NAME) throw new Error(`Open the Zenon app on your Ledger (now: ${name || 'dashboard'})`)
  }

  /** Ed25519 public key of m/44'/73404'/account'; `confirm` shows the address on the device. */
  publicKey(account: number, confirm = false): Promise<Uint8Array> {
    return this.run(async () => lengthPrefixed(await this.send(getPublicKeyApdu(account, confirm)), 32))
  }

  /** Sign the 306-byte transaction; the user confirms on the device. */
  signTransaction(account: number, tx: Uint8Array): Promise<Uint8Array> {
    return this.run(async () => {
      const apdus = signTxApdus(account, tx)
      let response: Uint8Array = new Uint8Array()
      for (const a of apdus) response = await this.send(a)
      return lengthPrefixed(response, 64)
    })
  }

  close(): Promise<void> {
    return this.transport.close()
  }
}
