import { expect, test, type Page } from '@playwright/test'
import { MockNode } from './mock-node'
import { KEYSTORE_ADDRESS } from './helpers'

// The keystore fixture's wallet, as a 24-word phrase.
const PHRASE =
  'abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware'
const WORDS = PHRASE.split(' ')

async function openImport(page: Page) {
  await new MockNode().attach(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Import Existing Wallet' }).click()
}

const word = (page: Page, i: number) => page.getByLabel(`Word ${i}`, { exact: true })

test('checks every word, and asks for a password only once the phrase is valid', async ({ page }) => {
  await openImport(page)
  await page.getByRole('group', { name: 'Number of words' }).getByRole('button', { name: '24' }).click()
  for (const [i, w] of WORDS.entries()) await word(page, i + 1).fill(i === 3 ? 'amonut' : w)

  await expect(word(page, 4)).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Not a recovery-phrase word: #4')).toBeVisible()
  await expect(page.locator('#import-password')).toHaveCount(0)

  await word(page, 4).fill('amount')
  await expect(page.getByText('Valid recovery phrase')).toBeVisible()
  await page.locator('#import-password').fill('Correct-Horse-Battery-77!')
  await page.locator('#import-confirm-password').fill('Correct-Horse-Battery-77!')
  await page.getByRole('button', { name: 'Import Wallet' }).click()
  await expect(page.getByLabel('Settings')).toBeVisible({ timeout: 30_000 })

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nom-wallet-storage') ?? '{}'))
  expect(stored.wallets[0].baseAddress).toBe(KEYSTORE_ADDRESS)
})

test('pasting the whole phrase into the first field fills all 24 fields', async ({ page }) => {
  await openImport(page)
  await word(page, 1).focus()
  await page.evaluate((text) => {
    const data = new DataTransfer()
    data.setData('text', `1. ${text.split(' ').join('\n')}`)
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, PHRASE)
  await expect(word(page, 24)).toHaveValue('unaware')
  await expect(page.getByText('Valid recovery phrase')).toBeVisible()
  await expect(page.locator('#import-password')).toBeVisible()
})

test('flags a phrase whose words are all valid but whose checksum is not', async ({ page }) => {
  await openImport(page)
  await page.getByRole('button', { name: 'Paste phrase' }).click()
  const swapped = [...WORDS]
  ;[swapped[0], swapped[23]] = [swapped[23], swapped[0]]
  await page.getByLabel('Recovery phrase', { exact: true }).fill(swapped.join(' '))
  await expect(page.getByText(/the phrase is not: check the order/)).toBeVisible()
  await expect(page.locator('#import-password')).toHaveCount(0)
})
