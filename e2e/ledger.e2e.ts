import { expect, test, type Page } from '@playwright/test'
import * as ed from '@noble/ed25519'
import { KeyStore } from 'znn-typescript-sdk'
import { MockNode } from './mock-node'
import { OTHER_ADDRESS, decode, waitForPublished } from './helpers'

// The fake device holds this seed; account 0 is the keystore fixture's address.
const MNEMONIC =
  'abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware'
const keyStore = KeyStore.fromMnemonic(MNEMONIC)
const ADDRESS = keyStore.getBaseAddress().toString()

/** Plug the software Ledger (src/core/ledger/fake-ledger.ts) in as the transport (dev builds only). */
async function withFakeLedger(page: Page, options: { reject?: boolean } = {}) {
  await page.addInitScript(
    ({ seed, reject }) => {
      ;(window as unknown as { __nomLedgerTransport: () => Promise<unknown> }).__nomLedgerTransport = async () => {
        // Served by the Vite dev server; a variable keeps TypeScript from resolving it.
        const modulePath = '/src/core/ledger/fake-ledger.ts'
        const { FakeZenonLedger } = await import(/* @vite-ignore */ modulePath)
        const device = new FakeZenonLedger(seed)
        if (reject) device.approve = () => false
        return device
      }
    },
    { seed: keyStore.seed, reject: !!options.reject }
  )
}

async function connectLedger(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Import Existing Wallet' }).click()
  await page.getByRole('button', { name: 'Ledger', exact: true }).click()
  await page.getByRole('button', { name: 'Connect Ledger' }).click()
  await expect(page.getByLabel('Settings')).toBeVisible({ timeout: 30_000 })
}

async function sendZnn(page: Page, amount: string) {
  await page.getByRole('button', { name: /Send/ }).first().click()
  // Wait for the token step of the Send page, then pick ZNN from its list.
  await expect(page.getByRole('heading', { name: 'Select Token to Send' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('main').getByText('ZNN', { exact: true }).first().click()
  await expect(page.locator('#recipient')).toBeVisible({ timeout: 30_000 })
  await page.locator('#recipient').fill(OTHER_ADDRESS)
  await page.locator('#amount').fill(amount)
  await page.getByRole('button', { name: /^Send/ }).last().click()
}

test('adds a Ledger wallet and signs a send on the device', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await withFakeLedger(page)
  await connectLedger(page)

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nom-wallet-storage') ?? '{}'))
  expect(stored.wallets[0]).toMatchObject({ kind: 'ledger', baseAddress: ADDRESS })
  expect(stored.wallets[0].accounts[0].publicKey).toBe(keyStore.getKeyPair(0).getPublicKey().toString('hex'))

  await sendZnn(page, '1.5')
  await waitForPublished(node.published, 1)
  const block = node.published[0] as unknown as { hash: string; signature: string; publicKey: string; address: string }
  expect(decode(node.published[0])).toMatchObject({ amount: '150000000', to: OTHER_ADDRESS })
  expect(block.address).toBe(ADDRESS)
  // A real signature from the device key over the block hash, not the dummy.
  const signature = Buffer.from(block.signature, 'base64')
  expect(signature.equals(Buffer.alloc(64))).toBe(false)
  expect(
    await ed.verifyAsync(signature, Buffer.from(block.hash, 'hex'), Buffer.from(block.publicKey, 'base64'))
  ).toBe(true)
})

test('a rejection on the device sends nothing', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await withFakeLedger(page, { reject: true })
  await connectLedger(page)
  await sendZnn(page, '1')
  await expect(page.getByText('Rejected on the Ledger').first()).toBeVisible({ timeout: 30_000 })
  expect(node.published).toHaveLength(0)
})

test('unlocks without a password and keeps swaps off', async ({ page }) => {
  await new MockNode().attach(page)
  await withFakeLedger(page)
  await connectLedger(page)

  await page.getByRole('button', { name: 'Lock wallet' }).click()
  await page.getByRole('button', { name: 'Unlock wallet' }).click()
  await expect(page.getByText(/no password needed/)).toBeVisible()
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Lock wallet' })).toBeVisible()

  await page.getByRole('link', { name: /P2P Swaps/ }).click()
  await expect(page.getByText(/not available for Ledger accounts/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review' })).toHaveCount(0)
})
