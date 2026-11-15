import { describe, expect, it } from 'vitest'
import { AccountBlockTemplate, KeyStore, Zenon, ZNN_ZTS } from 'znn-typescript-sdk'
import { buildCreateProjectBlock } from '@/core/accelerator-service'
import { ProjectStatus } from '@/core/accelerator-rules'

/**
 * Live Accelerator-Z check on the public testnet: the wallet's CreateProject
 * block (exactly 1 ZNN) is accepted and the project appears in voting, and a
 * small donation goes through. Costs 1.1 testnet ZNN per run, so it also needs
 * TESTNET_ACCELERATOR=1:
 *
 *   TESTNET_MNEMONIC="…" TESTNET_ACCELERATOR=1 npm run e2e:testnet
 */

const RPC = process.env.TESTNET_RPC ?? 'https://rpc.testnet.zenon.info'
const CHAIN_ID = Number(process.env.TESTNET_CHAIN_ID ?? 73404)
const MNEMONIC = process.env.TESTNET_MNEMONIC ?? ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!MNEMONIC || process.env.TESTNET_ACCELERATOR !== '1')('testnet: Accelerator-Z', () => {
  it('creates a project for 1 ZNN and donates', async () => {
    const zenon = Zenon.getInstance()
    Zenon.setChainID(CHAIN_ID)
    await zenon.initialize(RPC)
    const keyPair = KeyStore.fromMnemonic(MNEMONIC).getKeyPair(0)
    const owner = keyPair.getAddress().toString()

    const pending = await zenon.ledger.getUnreceivedBlocksByAddress(keyPair.getAddress(), 0, 10)
    for (const block of pending.list) await zenon.send(AccountBlockTemplate.receive(block.hash), keyPair)

    const name = `nom-webwallet e2e ${Date.now() % 1_000_000}`
    await zenon.send(
      buildCreateProjectBlock({
        name,
        description: 'Automated wallet test; please ignore.',
        url: 'https://testnet.zenon.info',
        znn: 1n,
        qsr: 0n,
      }),
      keyPair
    )

    let project = null
    for (let i = 0; i < 60 && !project; i++) {
      await sleep(3_000)
      const all = await zenon.embedded.accelerator.getAll(0, 50)
      project = all.list.find((p) => p.name === name && p.owner.toString() === owner) ?? null
    }
    expect(project).not.toBeNull()
    expect(project?.statusInt).toBe(ProjectStatus.Voting)

    const donated = await zenon.send(zenon.embedded.accelerator.donate(10_000_000n, ZNN_ZTS), keyPair)
    expect(donated.hash.toString()).toHaveLength(64)
  }, 900_000)
})
