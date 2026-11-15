import { expect, test } from '@playwright/test'
import { MockNode } from './mock-node'
import { KEYSTORE_ADDRESS, OTHER_ADDRESS, decode, importFixtureWallet, waitForPublished } from './helpers'

const PILLAR = {
  name: 'TestPillar',
  rank: 4,
  type: 2,
  ownerAddress: KEYSTORE_ADDRESS,
  producerAddress: OTHER_ADDRESS,
  withdrawAddress: KEYSTORE_ADDRESS,
  giveMomentumRewardPercentage: 0,
  giveDelegateRewardPercentage: 100,
  isRevocable: false,
  revokeCooldown: 86_400 * 20,
  revokeTimestamp: 0,
  currentStats: { producedMomentums: 40, expectedMomentums: 42 },
  weight: '123400000000000',
}

async function openNodesPage(page: import('@playwright/test').Page) {
  await importFixtureWallet(page)
  await page.getByRole('tab', { name: 'Pillar' }).click()
  await page.getByRole('link', { name: /Manage it here/ }).click()
  await expect(page.getByRole('heading', { name: 'Pillar & Sentinel' })).toBeVisible()
}

test('updates the reward percentages of an owned pillar', async ({ page }) => {
  const node = new MockNode({ handlers: { 'embedded.pillar.getByOwner': () => [PILLAR] } })
  await node.attach(page)
  await openNodesPage(page)

  await expect(page.getByText('Revocable in 20 days')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Revoke' }).first()).toBeDisabled()

  await page.getByRole('button', { name: 'Update', exact: true }).click()
  await page.locator('#pillar-give-momentum').fill('10')
  await page.locator('#pillar-give-delegate').fill('90')
  await page.getByRole('button', { name: 'Save Changes' }).click()

  await waitForPublished(node.published, 1)
  expect(decode(node.published[0])).toMatchObject({
    method: 'UpdatePillar',
    args: ['TestPillar', OTHER_ADDRESS, KEYSTORE_ADDRESS, 10, 90],
    amount: '0',
  })
})

test('registers a sentinel: deposits QSR (as QSR), then registers with 5,000 ZNN', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await openNodesPage(page)

  await page.getByRole('button', { name: 'Register Sentinel' }).click()
  await waitForPublished(node.published, 2)
  const [deposit, register] = node.published.map(decode)
  expect(deposit).toMatchObject({ method: 'DepositQsr', token: 'zts1qsrxxxxxxxxxxxxxmrhjll', amount: '5000000000000' })
  expect(register).toMatchObject({ method: 'Register', token: 'zts1znnxxxxxxxxxxxxx9z4ulx', amount: '500000000000' })
})

test('rejects an invalid pillar name before publishing', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await openNodesPage(page)

  await page.getByRole('button', { name: 'Register Pillar' }).click()
  await page.locator('#pillar-name').fill('bad name')
  await page.locator('#pillar-producer').fill(OTHER_ADDRESS)
  await expect(page.getByText(/Letters and digits/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Register', exact: true })).toBeDisabled()
  expect(node.published).toHaveLength(0)
})
