import { expect, test, type Page } from '@playwright/test'
import { MockNode } from './mock-node'
import { KEYSTORE_ADDRESS, importFixtureWallet } from './helpers'

const TESTNET_CHAIN = 73404
const RECEIVED = {
  version: 1,
  chainIdentifier: TESTNET_CHAIN,
  blockType: 2,
  hash: 'ab'.repeat(32),
  previousHash: '00'.repeat(32),
  height: 1,
  momentumAcknowledged: { hash: '00'.repeat(32), height: 1 },
  address: KEYSTORE_ADDRESS,
  toAddress: 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7',
  amount: '100000000',
  tokenStandard: 'zts1znnxxxxxxxxxxxxx9z4ulx',
  fromBlockHash: '00'.repeat(32),
  descendantBlocks: [],
  data: '',
  fusedPlasma: 21000,
  difficulty: 0,
  nonce: '0000000000000000',
  publicKey: '',
  signature: '',
  token: null,
  confirmationDetail: {
    numConfirmations: 1,
    momentumHeight: 2,
    momentumHash: '00'.repeat(32),
    momentumTimestamp: 1_700_000_000,
  },
  pairedAccountBlock: null,
}

async function openNetworkSettings(page: Page) {
  await page.getByLabel('Settings').click()
  await page.getByRole('tab', { name: 'Network' }).click()
}

/** Switch and wait for the reload that follows a successful switch. */
async function switchTo(page: Page, label: 'Mainnet' | 'Testnet') {
  await openNetworkSettings(page)
  const reloaded = page.waitForEvent('load', { timeout: 30_000 })
  await page.getByRole('group', { name: 'Network' }).getByRole('button', { name: label }).click()
  await reloaded
}

test('switches to testnet: banner, testnet explorer links, and back', async ({ page }) => {
  const node = new MockNode({
    chainIdFor: (url) => (url.includes('testnet') ? TESTNET_CHAIN : 1),
    handlers: {
      'ledger.getAccountBlocksByPage': () => ({ count: 1, list: [RECEIVED], more: false }),
    },
  })
  await node.attach(page)
  await importFixtureWallet(page)
  await expect(page.getByText('TESTNET · tokens have no value')).toBeHidden()

  await switchTo(page, 'Testnet')
  // The wallet reloads on the new network.
  await expect(page.getByText('TESTNET · tokens have no value')).toBeVisible({ timeout: 30_000 })
  // The header sits right below the banner, not a banner's height further down.
  const banner = await page.getByRole('status').filter({ hasText: 'TESTNET' }).boundingBox()
  const header = await page.locator('header').first().boundingBox()
  expect(Math.abs(header!.y - (banner!.y + banner!.height))).toBeLessThan(2)
  // A tooltip by the top edge opens over the banner, not under it.
  await page.getByLabel(/^Network (dis)?connected$/).hover()
  const tip = page.locator('[data-reka-popper-content-wrapper]').filter({ hasText: 'testnet' })
  await expect(tip).toBeVisible()
  const box = (await tip.boundingBox())!
  expect(box.y).toBeLessThan(banner!.y + banner!.height) // it does reach into the strip
  const onTop = await page.evaluate(
    ([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-reka-popper-content-wrapper]'),
    // a point inside the banner's strip
    [box.x + box.width / 2, Math.max(box.y + 4, banner!.y + 4)]
  )
  expect(onTop).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('nom-wallet-chain-id'))).toBe(
    String(TESTNET_CHAIN)
  )
  expect(await page.evaluate(() => localStorage.getItem('nom-wallet-selected-node'))).toContain(
    'testnet'
  )

  await page.getByRole('tab', { name: 'History' }).click()
  await expect(page.getByLabel('View in explorer')).toHaveAttribute(
    'href',
    `https://explorer.testnet.zenon.info/transaction/${'ab'.repeat(32)}`
  )

  await switchTo(page, 'Mainnet')
  await expect(page.getByText('TESTNET · tokens have no value')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('nom-wallet-chain-id'))).toBe('1')
})

test('refuses a testnet node that reports another chain', async ({ page }) => {
  // Every node claims to be mainnet, so the testnet switch must not stick.
  const node = new MockNode({ chainIdFor: () => 1 })
  await node.attach(page)
  await importFixtureWallet(page)

  await openNetworkSettings(page)
  await page
    .getByRole('group', { name: 'Network' })
    .getByRole('button', { name: 'Testnet' })
    .click()
  await expect(page.getByText(/is on chain 1, not Testnet/)).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => localStorage.getItem('nom-wallet-chain-id'))).not.toBe(
    String(TESTNET_CHAIN)
  )
  await expect(page.getByText('TESTNET · tokens have no value')).toBeHidden()
})

test('warns loudly when the node is on another chain than the wallet', async ({ page }) => {
  const node = new MockNode({ chainIdFor: () => TESTNET_CHAIN })
  await node.attach(page)
  await importFixtureWallet(page)
  await expect(page.getByText(`Node is on chain ${TESTNET_CHAIN}, wallet expects 1`)).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Switch to mainnet' })).toBeVisible()
})
