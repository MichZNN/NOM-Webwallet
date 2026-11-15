import { expect, test, type Page } from '@playwright/test'
import { MockNode } from './mock-node'
import { KEYSTORE_ADDRESS, OTHER_ADDRESS, decode, importFixtureWallet, waitForPublished } from './helpers'

const ZNN = 'zts1znnxxxxxxxxxxxxx9z4ulx'
const QSR = 'zts1qsrxxxxxxxxxxxxxmrhjll'
const now = () => Math.floor(Date.now() / 1000)
const hash = (n: number) => n.toString(16).padStart(64, '0')
const votes = (id: string, yes = 0, no = 0, total = 0) => ({ id, yes, no, total })

function project(n: number, overrides: Record<string, unknown> = {}) {
  const id = hash(n)
  return {
    id,
    owner: OTHER_ADDRESS,
    name: `Project ${n}`,
    description: `Description ${n}`,
    url: 'https://example.com/p',
    znnFundsNeeded: '50000000000',
    qsrFundsNeeded: '500000000000',
    creationTimestamp: now() - 86_400,
    lastUpdateTimestamp: now() - 86_400,
    status: 0,
    phaseIds: [],
    votes: votes(id, 3, 1, 5),
    phases: [],
    ...overrides,
  }
}

const OWNED_PILLAR = {
  name: 'TestPillar', rank: 1, type: 2, ownerAddress: KEYSTORE_ADDRESS, producerAddress: OTHER_ADDRESS,
  withdrawAddress: KEYSTORE_ADDRESS, giveMomentumRewardPercentage: 0, giveDelegateRewardPercentage: 100,
  isRevocable: false, revokeCooldown: 1, revokeTimestamp: 0,
  currentStats: { producedMomentums: 1, expectedMomentums: 1 }, weight: '1',
}

function node(projects: unknown[], extra: Record<string, (p: unknown[]) => unknown> = {}) {
  return new MockNode({
    handlers: {
      'embedded.accelerator.getAll': () => ({ count: projects.length, list: projects }),
      'embedded.accelerator.getPillarVotes': ([, ids]) => (ids as string[]).map(() => null),
      'embedded.pillar.getAll': () => ({ count: 30, list: [] }),
      ...extra,
    },
  })
}

async function openAccelerator(page: Page) {
  await importFixtureWallet(page)
  await page.getByRole('link', { name: /Accelerator-Z/ }).click()
  await expect(page.getByRole('heading', { name: 'Accelerator-Z' })).toBeVisible()
}

test('a pillar owner votes on a project in voting', async ({ page }) => {
  const p = project(1)
  const mock = node([p], { 'embedded.pillar.getByOwner': () => [OWNED_PILLAR] })
  await mock.attach(page)
  await openAccelerator(page)

  await expect(page.getByText('Voting as pillar')).toBeVisible()
  await page.getByRole('heading', { name: 'Project 1' }).click()
  await expect(page.getByText('Voting ends in 12 days 23 hours')).toBeVisible()
  await expect(page.getByText('3 yes · 1 no · 1 abstain · 5/10 votes needed')).toBeVisible()
  await page.getByRole('button', { name: 'Yes', exact: true }).click()

  await waitForPublished(mock.published, 1)
  expect(decode(mock.published[0])).toMatchObject({ method: 'VoteByName', args: [`0x${p.id}`, 'TestPillar', 0], amount: '0' })
})

test('accounts without a pillar get no vote buttons', async ({ page }) => {
  await node([project(1)]).attach(page)
  await openAccelerator(page)
  await page.getByRole('heading', { name: 'Project 1' }).click()
  await expect(page.getByText(/votes needed/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yes', exact: true })).toHaveCount(0)
})

test('creates a project for exactly 1 ZNN', async ({ page }) => {
  const mock = node([])
  await mock.attach(page)
  await openAccelerator(page)

  await page.getByRole('button', { name: 'Create Project' }).click()
  await page.locator('#project-name').fill('Wallet work')
  await page.locator('#project-description').fill('Testnet switch and Accelerator-Z')
  await page.locator('#project-url').fill('my-site.com')
  await page.locator('#project-znn').fill('1000')
  await page.locator('#project-qsr').fill('10000')
  await page.getByRole('button', { name: /Create for 1 ZNN/ }).click()
  await expect(page.getByText(/no "-" in the first part of the domain/)).toBeVisible()
  expect(mock.published).toHaveLength(0)

  await page.locator('#project-url').fill('https://example.com/wallet')
  await page.getByRole('button', { name: /Create for 1 ZNN/ }).click()
  await waitForPublished(mock.published, 1)
  expect(decode(mock.published[0])).toMatchObject({
    method: 'CreateProject',
    args: ['Wallet work', 'Testnet switch and Accelerator-Z', 'https://example.com/wallet', '100000000000', '1000000000000'],
    token: ZNN,
    amount: '100000000',
  })
})

test('donates QSR to the fund', async ({ page }) => {
  const mock = node([])
  await mock.attach(page)
  await openAccelerator(page)

  await page.getByRole('button', { name: 'Donate' }).click()
  await page.locator('#donate-amount').fill('2.5')
  await page.getByRole('combobox', { name: 'Token' }).click()
  await page.getByRole('option', { name: 'QSR' }).click()
  await page.locator('form').getByRole('button', { name: 'Donate' }).click()
  await waitForPublished(mock.published, 1)
  expect(decode(mock.published[0])).toMatchObject({ method: 'Donate', token: QSR, amount: '250000000' })
})

test('the owner adds a phase and updates it by project id', async ({ page }) => {
  const active = project(2, { owner: KEYSTORE_ADDRESS, status: 1 })
  const phaseId = hash(99)
  const withPhase = {
    ...active,
    phaseIds: [phaseId],
    phases: [{
      phase: { id: phaseId, projectID: active.id, name: 'Phase A', description: 'First', url: 'https://example.com/a',
        znnFundsNeeded: '10000000000', qsrFundsNeeded: '0', creationTimestamp: now(), acceptedTimestamp: 0, status: 0 },
      votes: votes(phaseId),
    }],
  }
  // After the AddPhase block is published, the node returns the project with its phase.
  const mock: MockNode = node([], {
    'embedded.accelerator.getAll': () => ({ count: 1, list: [mock.published.length ? withPhase : active] }),
  })
  await mock.attach(page)
  await openAccelerator(page)

  await page.getByRole('heading', { name: 'Project 2' }).click()
  await page.getByRole('button', { name: 'Add Phase' }).click()
  await page.locator('#project-name').fill('Phase A')
  await page.locator('#project-description').fill('First')
  await page.locator('#project-url').fill('https://example.com/a')
  await page.locator('#project-znn').fill('501')
  await page.getByRole('button', { name: 'Add Phase' }).last().click()
  await expect(page.getByText('More ZNN than the project has left')).toBeVisible()
  await page.getByRole('button', { name: 'Use all' }).click()
  await page.getByRole('button', { name: 'Add Phase' }).last().click()
  await waitForPublished(mock.published, 1)
  expect(decode(mock.published[0])).toMatchObject({
    method: 'AddPhase',
    args: [`0x${active.id}`, 'Phase A', 'First', 'https://example.com/a', '50000000000', '500000000000'],
  })

  await expect(page.getByText('Phase 1: Phase A')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Update Phase' }).click()
  await page.locator('#project-description').fill('First, reworked')
  await page.getByRole('button', { name: 'Update Phase' }).last().click()
  await waitForPublished(mock.published, 2)
  const update = decode(mock.published[1])
  expect(update).toMatchObject({ method: 'UpdatePhase', args: [`0x${active.id}`, 'Phase A', 'First, reworked', 'https://example.com/a', '10000000000', '0'] })
})

test('a project past its 14 days shows no outcome and no vote buttons', async ({ page }) => {
  // Enough yes votes, but created 15 days ago: the chain will close it.
  const expired = project(3, { creationTimestamp: now() - 15 * 86_400, votes: votes(hash(3), 20, 0, 20) })
  await node([expired], { 'embedded.pillar.getByOwner': () => [OWNED_PILLAR] }).attach(page)
  await openAccelerator(page)
  await page.getByRole('heading', { name: 'Project 3' }).click()
  await expect(page.getByText('Voting ended', { exact: true })).toBeVisible()
  await expect(page.getByText(/voting period is over without acceptance/)).toBeVisible()
  await expect(page.getByText('Voting closed')).toBeVisible()
  await expect(page.getByText('Passing')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Yes', exact: true })).toHaveCount(0)
})
