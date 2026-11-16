import {ZenonLedgerApp} from './ledger-app'
import type {LedgerTransport} from './ledger-app'

let app: Promise<ZenonLedgerApp> | null = null
let unplugWatch = false

/** WebHID is needed for Ledger (Chrome, Edge, Brave, Opera on desktop). */
export function isLedgerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator
}

type TransportFactory = () => Promise<LedgerTransport>

async function webHidTransport(): Promise<LedgerTransport> {
  const {default: TransportWebHID} = await import('@ledgerhq/hw-transport-webhid')
  // Reuses an already-permitted device, else shows the browser's device chooser
  // (that needs a user gesture: call from a click handler).
  const transport = await TransportWebHID.create()
  return {
    async exchange(apdu) {
      return new Uint8Array(await transport.exchange(Buffer.from(apdu)))
    },
    async close() {
      await transport.close()
    },
  }
}

function factory(): TransportFactory {
  // Dev builds only: lets end-to-end tests plug in a fake device.
  if (import.meta.env.DEV) {
    const hook = (globalThis as { __nomLedgerTransport?: TransportFactory }).__nomLedgerTransport
    if (hook) return hook
  }
  return webHidTransport
}

/**
 * The connected Zenon app, connecting on first use. Concurrent first calls share
 * one connection; a failed connect is forgotten so the next call retries.
 */
export function getLedgerApp(): Promise<ZenonLedgerApp> {
  if (app) return app
  if (!isLedgerSupported() && !import.meta.env.DEV) {
    return Promise.reject(new Error('This browser cannot talk to a Ledger (use Chrome, Edge or Brave on desktop)'))
  }
  watchUnplug()
  const connecting = factory()()
    .then((transport) => new ZenonLedgerApp(transport))
    .catch((err) => {
      if (app === connecting) app = null
      throw new Error(
        err instanceof Error && /permission|gesture|No device selected/i.test(err.message)
          ? 'Connect the Ledger again from the wallet settings (the browser needs you to pick the device)'
          : err instanceof Error
            ? err.message
            : 'Could not connect to the Ledger'
      )
    })
  app = connecting
  return connecting
}

/** Forget the device (after an error, a timeout or an unplug); the next use reconnects. */
export async function disconnectLedger(): Promise<void> {
  const current = app
  app = null
  if (!current) return
  await current.then((a) => a.close()).catch(() => undefined)
}

function watchUnplug(): void {
  if (unplugWatch || !isLedgerSupported()) return
  unplugWatch = true
  ;(navigator as Navigator & { hid: EventTarget }).hid.addEventListener('disconnect', () => {
    void disconnectLedger()
  })
}
