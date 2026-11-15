import { expect, test } from '@playwright/test'
import { MockNode } from './mock-node'
import { KEYSTORE, KEYSTORE_ADDRESS, KEYSTORE_PASSWORD, importFixtureWallet } from './helpers'

test.beforeEach(async ({ page }) => {
  await new MockNode().attach(page)
})

test('imports a Syrius keystore file', async ({ page }) => {
  await importFixtureWallet(page)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nom-wallet-storage') ?? '{}'))
  expect(stored.wallets.map((w: { baseAddress: string }) => w.baseAddress)).toEqual([KEYSTORE_ADDRESS])
})

test('refuses to add the same wallet twice', async ({ page }) => {
  await importFixtureWallet(page)
  await page.getByLabel('Settings').click()
  await page.getByRole('button', { name: 'Add Wallet' }).click()
  await page.getByRole('button', { name: 'Import Existing Wallet' }).click()
  await page.getByRole('button', { name: 'Keystore File' }).click()
  await page.locator('#keystore-file').setInputFiles(KEYSTORE)
  await page.locator('#keystore-password').fill(KEYSTORE_PASSWORD)
  await page.getByRole('button', { name: 'Import Wallet' }).click()
  await expect(page.getByText('This wallet has already been added')).toBeVisible({ timeout: 30_000 })
})

test('changes the password', async ({ page }) => {
  const next = 'Totally-New-Secret-91#'
  await importFixtureWallet(page)
  await page.getByLabel('Settings').click()
  await page.locator('[role=dialog] button:has(svg.lucide-ellipsis-vertical), [role=dialog] button:has(svg.lucide-more-vertical)').first().click()
  await page.getByRole('menuitem', { name: 'Change Password' }).click()
  await page.locator('#current-password').fill('wrong-password')
  await page.locator('#new-password').fill(next)
  await page.locator('#confirm-new-password').fill(next)
  await page.getByRole('button', { name: 'Change Password' }).last().click()
  await expect(page.getByText('Current password is incorrect')).toBeVisible({ timeout: 30_000 })

  await page.locator('#current-password').fill(KEYSTORE_PASSWORD)
  await page.getByRole('button', { name: 'Change Password' }).last().click()
  await expect(page.locator('#current-password')).toBeHidden({ timeout: 30_000 })
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Lock wallet' }).click()
  await page.getByRole('button', { name: 'Unlock wallet' }).click()
  await page.getByPlaceholder('Enter password').fill(KEYSTORE_PASSWORD)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByText('Invalid password')).toBeVisible({ timeout: 30_000 })
  await page.getByPlaceholder('Enter password').fill(next)
  await page.getByRole('button', { name: 'Unlock', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Lock wallet' })).toBeVisible({ timeout: 30_000 })
})
