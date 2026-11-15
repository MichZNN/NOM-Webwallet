import { describe, expect, it } from 'vitest'
import { AccountBlockTemplate, Address, Hash, KeyStore, TokenStandard, Zenon } from 'znn-typescript-sdk'
import { encodePath, getPublicKeyApdu, signTxApdus, TX_LENGTH, LedgerStatusError } from './apdu'
import { ZenonLedgerApp } from './ledger-app'
import { FakeZenonLedger } from './fake-ledger'
import { LedgerKeyPair, signWithLedger } from './ledger-sign'
import { transactionBytes } from './tx-bytes'

const MNEMONIC =
  'abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware'
const keyStore = KeyStore.fromMnemonic(MNEMONIC)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** A Zenon instance whose RPC answers just what prepareBlock needs. */
function offlineZenon(chainId = 1): Zenon {
  const zenon = Zenon.getInstance()
  const client = {
    async sendRequest(method: string) {
      if (method === 'ledger.getFrontierAccountBlock') return null
      if (method === 'ledger.getFrontierMomentum')
        return {
          version: 1, chainIdentifier: chainId, hash: 'ab'.repeat(32), previousHash: 'ab'.repeat(32), height: 42,
          timestamp: 1_700_000_000, data: '', content: [], changesHash: 'ab'.repeat(32), publicKey: '', signature: '',
          producer: 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7',
        }
      if (method === 'embedded.plasma.getRequiredPoWForAccountBlock')
        return { availablePlasma: 100_000, basePlasma: 21_000, requiredDifficulty: 0 }
      throw new Error(`unexpected ${method}`)
    },
  }
  ;(zenon as unknown as { _setClient(c: unknown): void })._setClient(client)
  return zenon
}

/** Prepare with a Ledger key pair the way TransactionService does. */
async function prepareWithLedger(kp: LedgerKeyPair, chainId = 1) {
  kp.preparing = true
  try {
    return await offlineZenon(chainId).prepareBlock(sendBlock(chainId), kp as never)
  } finally {
    kp.preparing = false
  }
}

function sendBlock(chainId = 1) {
  return new AccountBlockTemplate({
    blockType: 2,
    chainIdentifier: chainId,
    toAddress: Address.parse('z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'),
    amount: 123_456_789n,
    tokenStandard: TokenStandard.parse('zts1znnxxxxxxxxxxxxx9z4ulx'),
    data: Buffer.from('deadbeef', 'hex'),
  })
}

describe('APDU encoding (matches znn_ledger_dart and the app tests)', () => {
  it("encodes m/44'/73404'/i' as count + big-endian hardened u32s", () => {
    expect(hex(encodePath(0))).toBe('03' + '8000002c' + '80011ebc' + '80000000')
    expect(hex(encodePath(5))).toBe('03' + '8000002c' + '80011ebc' + '80000005')
  })

  it('asks for a public key with or without on-device confirmation', () => {
    expect(hex(getPublicKeyApdu(1, false))).toBe('e005000' + '00d' + hex(encodePath(1)))
    expect(hex(getPublicKeyApdu(1, true)).slice(0, 8)).toBe('e0050100')
  })

  it('sends SIGN_TX as path, then 255 + 51 bytes; P2 0x80 = more, 0x00 = last', () => {
    const tx = new Uint8Array(TX_LENGTH).fill(7)
    const apdus = signTxApdus(0, tx)
    expect(apdus.map((a) => hex(a.subarray(0, 5)))).toEqual(['e00600800d', 'e0060180ff', 'e006020033'])
    expect(() => signTxApdus(0, new Uint8Array(100))).toThrow(/306 bytes/)
  })
})

describe('transactionBytes', () => {
  it('is exactly the preimage of the SDK block hash', async () => {
    const tx = await offlineZenon().prepareBlock(sendBlock(), keyStore.getKeyPair(0))
    const bytes = transactionBytes(tx)
    expect(bytes).toHaveLength(TX_LENGTH)
    expect(Hash.digest(Buffer.from(bytes)).toString()).toBe(tx.hash.toString())
  })
})

describe('Ledger signing with the fake device', () => {
  it('derives the same accounts as the SDK for the same seed', async () => {
    const app = new ZenonLedgerApp(new FakeZenonLedger(keyStore.seed))
    for (const i of [0, 1, 7]) {
      expect(hex(await app.publicKey(i))).toBe(hex(keyStore.getKeyPair(i).getPublicKey()))
    }
  })

  it('signs a prepared block with a signature that verifies, without the dummy', async () => {
    const device = new FakeZenonLedger(keyStore.seed)
    const app = new ZenonLedgerApp(device)
    const pub = await app.publicKey(0)
    const kp = new LedgerKeyPair(async () => app, 0, pub)
    const tx = await prepareWithLedger(kp)
    expect(tx.address.toString()).toBe(keyStore.getKeyPair(0).getAddress().toString())
    expect(hex(tx.signature)).toBe('00'.repeat(64)) // dummy from prepareBlock

    await signWithLedger(tx, kp, 1)
    // Same as signing with the private key: Ed25519 is deterministic.
    expect(hex(tx.signature)).toBe(hex(keyStore.getKeyPair(0).sign(tx.hash.getBytes())))
    expect(device.signed).toHaveLength(1)
  })

  it('reports a rejection on the device and leaves the dummy in place', async () => {
    const device = new FakeZenonLedger(keyStore.seed)
    device.approve = () => false
    const app = new ZenonLedgerApp(device)
    const kp = new LedgerKeyPair(async () => app, 0, await app.publicKey(0))
    const tx = await prepareWithLedger(kp)
    const err = await signWithLedger(tx, kp, 1).catch((e) => e)
    expect(err).toBeInstanceOf(LedgerStatusError)
    expect((err as LedgerStatusError).rejected).toBe(true)
    expect(err.message).toBe('Rejected on the Ledger')
  })

  it('refuses another device/seed, another chain, or the app not being open', async () => {
    const other = new ZenonLedgerApp(new FakeZenonLedger(KeyStore.newRandom().seed))
    const mine = new ZenonLedgerApp(new FakeZenonLedger(keyStore.seed))
    const pub = await mine.publicKey(0)

    const wrongDevice = new LedgerKeyPair(async () => other, 0, pub)
    const tx1 = await prepareWithLedger(wrongDevice)
    await expect(signWithLedger(tx1, wrongDevice, 1)).rejects.toThrow(/does not hold this account/)

    const kp = new LedgerKeyPair(async () => mine, 0, pub)
    const tx2 = await prepareWithLedger(kp, 73404)
    await expect(signWithLedger(tx2, kp, 1)).rejects.toThrow(/chain 73404/)

    const closedDevice = new FakeZenonLedger(keyStore.seed)
    closedDevice.appName = 'Bitcoin'
    const closed = new LedgerKeyPair(async () => new ZenonLedgerApp(closedDevice), 0, pub)
    const tx3 = await prepareWithLedger(closed)
    await expect(signWithLedger(tx3, closed, 1)).rejects.toThrow(/Open the Zenon app/)
  })

  it('never hands out the dummy signature outside block preparation', async () => {
    const app = new ZenonLedgerApp(new FakeZenonLedger(keyStore.seed))
    const kp = new LedgerKeyPair(async () => app, 0, await app.publicKey(0))
    expect(() => kp.sign()).toThrow(/only sign transactions/)
    expect(() => kp.getPrivateKey()).toThrow()
  })

  it('refuses a block whose bytes were altered after hashing', async () => {
    const app = new ZenonLedgerApp(new FakeZenonLedger(keyStore.seed))
    const kp = new LedgerKeyPair(async () => app, 0, await app.publicKey(0))
    const tx = await prepareWithLedger(kp)
    tx.amount = 1n
    await expect(signWithLedger(tx, kp, 1)).rejects.toThrow(/hash mismatch/)
  })
})
