import { expect, test } from '@playwright/test'
import { MockNode, token } from './mock-node'
import { KEYSTORE_ADDRESS, OTHER_ADDRESS, decode, importFixtureWallet, waitForPublished } from './helpers'

const MYT = 'zts1qurswpc8qurswpc806urfj'
const OWNED = token('MYT', MYT, {
  name: 'My-Token',
  domain: 'example.com',
  owner: KEYSTORE_ADDRESS,
  totalSupply: '100000000000',
  maxSupply: '500000000000',
})

async function openTokensPage(page: import('@playwright/test').Page) {
  await importFixtureWallet(page)
  await page.getByRole('link', { name: /Issue or manage your own tokens/ }).click()
  await expect(page.getByRole('heading', { name: 'My Tokens' })).toBeVisible()
}

test('issues a token for the 1 ZNN fee', async ({ page }) => {
  const node = new MockNode()
  await node.attach(page)
  await openTokensPage(page)

  await page.getByRole('button', { name: 'Issue Token' }).click()
  await page.locator('#issue-name').fill('My-Token')
  await page.locator('#issue-symbol').fill('myt')
  await page.locator('#issue-domain').fill('example.com')
  await page.getByLabel(/Mintable: more can be minted/).click()
  await page.locator('#issue-total').fill('1000')
  await page.locator('#issue-max').fill('5000')
  await page.getByRole('button', { name: 'Issue for 1 ZNN' }).click()

  await waitForPublished(node.published, 1)
  expect(decode(node.published[0])).toMatchObject({
    method: 'IssueToken',
    args: ['My-Token', 'MYT', 'example.com', '100000000000', '500000000000', 8, true, true, true],
    token: 'zts1znnxxxxxxxxxxxxx9z4ulx',
    amount: '100000000',
  })
})

test('mints, burns and updates an owned token', async ({ page }) => {
  const node = new MockNode({
    balances: { [MYT]: { token: OWNED, balance: '100000000000' } },
    handlers: { 'embedded.token.getByOwner': () => ({ count: 1, list: [OWNED] }) },
  })
  await node.attach(page)
  await openTokensPage(page)

  await page.getByRole('button', { name: 'Mint', exact: true }).click()
  await page.locator('#token-amount').fill('4001')
  await expect(page.getByText('More than can still be minted')).toBeVisible()
  await page.locator('#token-amount').fill('10')
  await page.locator('#token-receiver').fill(OTHER_ADDRESS)
  await page.locator('form').getByRole('button', { name: 'Mint', exact: true }).click()
  await waitForPublished(node.published, 1)

  await page.getByRole('button', { name: 'Burn', exact: true }).click()
  await page.locator('#token-amount').fill('1.5')
  await page.locator('form').getByRole('button', { name: 'Burn', exact: true }).click()
  await waitForPublished(node.published, 2)

  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page.getByLabel(/Burnable by any holder/).click()
  await page.getByRole('button', { name: 'Save Changes' }).click()
  await waitForPublished(node.published, 3)

  const [mint, burn, update] = node.published.map(decode)
  expect(mint).toMatchObject({ method: 'Mint', args: [MYT, '1000000000', OTHER_ADDRESS], amount: '0' })
  expect(burn).toMatchObject({ method: 'Burn', token: MYT, amount: '150000000' })
  expect(update).toMatchObject({ method: 'UpdateToken', args: [MYT, KEYSTORE_ADDRESS, true, false] })
})
