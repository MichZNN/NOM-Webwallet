import { expect, test, type Page } from '@playwright/test'
import { MockNode, QSR, ZNN, token } from './mock-node'
import { KEYSTORE_ADDRESS, OTHER_ADDRESS, decode, importFixtureWallet, waitForPublished } from './helpers'

const NOW = 1_700_000_000 // the mock's frontier momentum time
const HTLC = 'z1qxemdeddedxhtlcxxxxxxxxxxxxxxxxxygecvw'
const INITIAL_ID = 'ab'.repeat(32)
const LOCK = 'cd'.repeat(32)

function initialHtlc(overrides: Record<string, unknown> = {}) {
  return {
    id: INITIAL_ID,
    timeLocked: OTHER_ADDRESS,
    hashLocked: KEYSTORE_ADDRESS,
    tokenStandard: QSR,
    amount: '5000000000',
    expirationTime: NOW + 8 * 3600,
    hashType: 0,
    keyMaxSize: 255,
    hashLock: Buffer.from(LOCK, 'hex').toString('base64'),
    ...overrides,
  }
}

function node(htlc: unknown = null) {
  return new MockNode({
    handlers: {
      'embedded.htlc.getById': () => htlc,
      'embedded.token.getByZts': ([zts]) => (zts === QSR ? token('QSR', QSR) : token('ZNN', ZNN)),
      'ledger.getAccountBlockByHash': () => null,
      'ledger.getAccountBlocksByHeight': () => ({ count: 0, list: [], more: false }),
    },
  })
}

async function openSwaps(page: Page) {
  await importFixtureWallet(page)
  await page.getByRole('link', { name: /P2P Swaps/ }).click()
  await expect(page.getByRole('heading', { name: 'P2P Swaps' })).toBeVisible()
}

async function pickToken(page: Page, label: string, symbol: string) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: symbol }).click()
}

test('starting a swap locks the amount for 8 hours under a SHA3 hashlock', async ({ page }) => {
  const mock = node()
  await mock.attach(page)
  await openSwaps(page)

  await page.locator('#swap-to').fill(OTHER_ADDRESS)
  await page.locator('#swap-start-amount').fill('1.5')
  await pickToken(page, 'Token to send', 'ZNN')
  await page.getByRole('button', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Deposit and start' }).click()

  await waitForPublished(mock.published, 1)
  const create = decode(mock.published[0])
  expect(create).toMatchObject({ method: 'Create', to: HTLC, token: ZNN, amount: '150000000' })
  const [hashLocked, expirationTime, hashType, keyMaxSize, hashLock] = create.args
  expect({ hashLocked, expirationTime, hashType, keyMaxSize }).toEqual({
    hashLocked: OTHER_ADDRESS,
    expirationTime: String(NOW + 8 * 3600),
    hashType: 0,
    keyMaxSize: 255,
  })
  expect(String(hashLock)).toMatch(/^0x[0-9a-f]{64}$/)
  await expect(page.getByText('My swaps')).toBeVisible()
  await expect(page.getByText(/Share the swap ID/)).toBeVisible()
})

test('joining answers with the same hashlock for 1 hour, after an explicit acknowledgement', async ({ page }) => {
  const mock = node(initialHtlc())
  await mock.attach(page)
  await openSwaps(page)

  await page.locator('#swap-join-id').fill(INITIAL_ID)
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByText(/You get/)).toContainText('50 QSR')

  await page.locator('#swap-join-amount').fill('2')
  await pickToken(page, 'Token to send in return', 'ZNN')
  const join = page.getByRole('button', { name: /and join/ })
  await expect(join).toBeDisabled()
  await page.getByRole('checkbox').check()
  await join.click()

  await waitForPublished(mock.published, 1)
  const create = decode(mock.published[0])
  expect(create).toMatchObject({ method: 'Create', token: ZNN, amount: '200000000' })
  expect(create.args).toEqual([OTHER_ADDRESS, String(NOW + 3600), 0, 255, `0x${LOCK}`])
})

test.describe('refuses unsafe deposits', () => {
  for (const [name, htlc, message] of [
    ['not for me', initialHtlc({ hashLocked: OTHER_ADDRESS }), /not for this address/],
    ['expiring soon', initialHtlc({ expirationTime: NOW + 3 * 3600 }), /too soon/],
    ['SHA256', initialHtlc({ hashType: 1 }), /hash type/],
    ['missing', null, /No open deposit/],
  ] as const) {
    test(name, async ({ page }) => {
      const mock = node(htlc)
      await mock.attach(page)
      await openSwaps(page)
      await page.locator('#swap-join-id').fill(INITIAL_ID)
      await page.getByRole('button', { name: 'Check' }).click()
      await expect(page.getByText(message)).toBeVisible()
      await expect(page.getByText(/You get/)).toHaveCount(0)
      expect(mock.published).toHaveLength(0)
    })
  }
})

test('recovery reports when there is nothing to recover', async ({ page }) => {
  const mock = node()
  await mock.attach(page)
  await openSwaps(page)
  await page.getByRole('button', { name: 'Recover swaps' }).click()
  await expect(page.getByText('No other open swaps found')).toBeVisible({ timeout: 30_000 })
  expect(mock.published).toHaveLength(0)
})
