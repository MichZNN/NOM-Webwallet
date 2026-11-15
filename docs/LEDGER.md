# Ledger support

Ledger Nano S Plus / X / Stax / Flex with the **Zenon** app, over WebHID
(Chrome, Edge, Brave, Opera on desktop). Keys never leave the device.

## How it works

- **Adding:** Import Existing Wallet → **Ledger** → Connect. The browser asks
  which device to use; the address of account 0 is shown on the Ledger and
  must be approved. More accounts: Settings → Wallet → Add Account (each
  address is confirmed on the device first).
- **Unlocking** a Ledger wallet needs no password; the device is asked only
  when something is signed.
- **Signing** (`src/core/ledger/ledger-sign.ts`): every block goes through
  `TransactionService.publish`. Before anything is sent the wallet checks that
  the Zenon app is open, that the device holds this account (public key
  match), that the chain id is the active network's, and that the 306 bytes
  sent to the device hash to the block hash. The returned signature is
  verified with Ed25519 before publishing. A block approved on the device
  after the 3-minute limit is not sent.
- **Protocol** (`src/core/ledger/apdu.ts`): CLA 0xE0; INS 0x03 version,
  0x04 app name, 0x05 public key (P1 0x01 = show on device), 0x06 sign
  (path, then 255 + 51 bytes; P2 0x80 = more, 0x00 = last). The app's
  `doc/COMMANDS.md` has the P2 values swapped; its source is what we follow.

## Not available with a Ledger

- P2P swaps (the swap secret is derived from the account key, and completing
  needs background signing)
- Signing messages for dApps (the Zenon app has no message-signing command)
- Auto-receive (it would prompt on the device unasked; receive manually)
- Recovery phrase / keystore export and password change

## Tests without a device

`src/core/ledger/fake-ledger.ts` mimics the Zenon app (same APDU rules and
chunk state machine) and signs for real from a test seed. Unit tests
(`ledger.test.ts`) and e2e tests (`e2e/ledger.e2e.ts`, plugged in through a
dev-only hook) run the full prepare → device sign → verify → publish path.

## Checklist for a real device

1. Chrome/Edge on desktop, Ledger unlocked, Zenon app open.
2. Import Existing Wallet → Ledger → Connect; pick the device; the address on
   the screen must match the one the wallet then shows.
3. Add Account; confirm the second address on the device.
4. Send a small amount; check amount and recipient on the device, approve;
   the transaction appears in History.
5. Send again and **reject** on the device: "Rejected on the Ledger", nothing sent.
6. Receive a transaction manually (Receive page) and approve on the device.
7. Quit the Zenon app and try to send: "Open the Zenon app on your Ledger".
8. Extension: the device chooser may not open from the popup; open the wallet
   in a full tab to connect the first time.
