import { expect, test } from '@playwright/test'
import { MockNode } from './mock-node'
import { KEYSTORE_PASSWORD, decode, importFixtureWallet, waitForPublished } from './helpers'

test('fuses whole QSR only, like the chain requires', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await importFixtureWallet(page)
  await page.getByRole('tab', { name: 'Plasma' }).click()

  const amount = page.getByLabel('Amount (QSR)')
  const fuse = page.getByRole('button', { name: 'Fuse Plasma' })
  await amount.fill('10.01')
  await fuse.click()
  await expect(page.getByText('Fuse whole QSR only')).toBeVisible()
  expect(node.published).toHaveLength(0)

  await amount.fill('11')
  await fuse.click()
  await waitForPublished(node.published, 1)
  expect(decode(node.published[0])).toMatchObject({
    method: 'Fuse',
    token: 'zts1qsrxxxxxxxxxxxxxmrhjll',
    amount: '1100000000',
  })
})

test('a locked wallet offers to unlock instead of a dead Fuse button', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await importFixtureWallet(page)
  await page.getByRole('button', { name: 'Lock wallet' }).click()
  await page.getByRole('tab', { name: 'Plasma' }).click()
  await page.getByLabel('Amount (QSR)').fill('10')

  await expect(page.getByRole('button', { name: 'Fuse Plasma' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Unlock to fuse' }).click()
  await page.locator('#unlock-dialog-password').fill(KEYSTORE_PASSWORD)
  await page.locator('#unlock-dialog-password').press('Enter')

  await page.getByRole('button', { name: 'Fuse Plasma' }).click()
  await waitForPublished(node.published, 1)
  expect(decode(node.published[0])).toMatchObject({ method: 'Fuse', amount: '1000000000' })
})
