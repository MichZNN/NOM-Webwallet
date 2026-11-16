import { expect, test } from '@playwright/test'
import { MockNode } from './mock-node'
import { decode, importFixtureWallet, waitForPublished } from './helpers'

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
