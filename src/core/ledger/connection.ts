import {ZenonLedgerApp} from './ledger-app'
import type {LedgerTransport} from './ledger-app'

let app: ZenonLedgerApp | null = null

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

/** The connected Zenon app, connecting on first use. */
export async function getLedgerApp(): Promise<ZenonLedgerApp> {
  if (app) return app
  if (!isLedgerSupported() && !import.meta.env.DEV) {
    throw new Error('This browser cannot talk to a Ledger (use Chrome, Edge or Brave on desktop)')
  }
  const transport = await factory()()
  app = new ZenonLedgerApp(transport)
  return app
}

/** Forget the device (after an error or on request); the next use reconnects. */
export async function disconnectLedger(): Promise<void> {
  const current = app
  app = null
  await current?.close().catch(() => undefined)
}
