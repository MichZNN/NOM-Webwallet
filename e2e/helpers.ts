import { expect, type Page } from '@playwright/test'
import * as sdk from 'znn-typescript-sdk'
import type { PublishedBlock } from './mock-node'

/** Syrius-format keystore of a fixed test wallet (src/core/__fixtures__). */
export const KEYSTORE = new URL('../src/core/__fixtures__/syrius-keystore.json', import.meta.url).pathname
export const KEYSTORE_PASSWORD = 'Syrius-Test-Password!'
export const KEYSTORE_ADDRESS = 'z1qztvt7z2ydfuwsfdfupjlfl5duw0w9ct8aulct'
export const OTHER_ADDRESS = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'

/** First run: import the fixture wallet; it ends up unlocked on the home screen. */
export async function importFixtureWallet(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Import Existing Wallet' }).click()
  await page.getByRole('button', { name: 'Keystore File' }).click()
  await page.locator('#keystore-file').setInputFiles(KEYSTORE)
  await page.locator('#keystore-password').fill(KEYSTORE_PASSWORD)
  await page.getByRole('button', { name: 'Import Wallet' }).click()
  await expect(page.getByLabel('Settings')).toBeVisible({ timeout: 30_000 })
}

const CONTRACTS = [
  sdk.PillarContract,
  sdk.SentinelContract,
  sdk.TokenContract,
  sdk.CommonContract,
  sdk.StakeContract,
  sdk.PlasmaContract,
  sdk.AcceleratorContract,
  sdk.HtlcContract,
]

/** A published block as { method, args, token, amount, to } for assertions. */
export function decode(block: PublishedBlock) {
  const data = `0x${Buffer.from(block.data, 'base64').toString('hex')}`
  const plain = (v: unknown): unknown =>
    typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? String(v) : v
  for (const contract of CONTRACTS) {
    for (const fragment of contract.abi.fragments.filter((f: { type: string }) => f.type === 'function')) {
      try {
        const args = contract.abi.decodeFunctionData(fragment.name, data) as unknown[]
        return { method: fragment.name, args: args.map(plain), token: block.tokenStandard, amount: block.amount, to: block.toAddress }
      } catch {
        // not this function
      }
    }
  }
  return { method: null, args: [], token: block.tokenStandard, amount: block.amount, to: block.toAddress }
}

/** Wait until the mock node has seen `count` published blocks. */
export async function waitForPublished(published: PublishedBlock[], count: number): Promise<void> {
  await expect.poll(() => published.length, { timeout: 30_000 }).toBe(count)
}
