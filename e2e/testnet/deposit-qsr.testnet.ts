import { describe, expect, it } from 'vitest'
import { AccountBlockTemplate, KeyStore, Zenon } from 'znn-typescript-sdk'
import { buildDepositQsrBlock } from '@/core/node-service'

/**
 * Live check against the public testnet (https://testnet.zenon.info):
 * the wallet's DepositQsr block is accepted and the deposit can be withdrawn.
 *
 *   TESTNET_MNEMONIC="word1 … word24" npm run e2e:testnet
 *
 * The account needs a little testnet ZNN and QSR (faucet: https://faucet.zenonhub.io/).
 * Without plasma every block needs PoW, so a run takes a few minutes.
 */

const RPC = process.env.TESTNET_RPC ?? 'https://rpc.testnet.zenon.info'
const CHAIN_ID = Number(process.env.TESTNET_CHAIN_ID ?? 73404)
const MNEMONIC = process.env.TESTNET_MNEMONIC ?? ''
const ONE_QSR = 100_000_000n

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 180_000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > end) return value
    await sleep(3_000)
  }
}

describe.skipIf(!MNEMONIC)('testnet: QSR deposit for sentinels', () => {
  it('deposits 1 QSR with the wallet-built block and withdraws it again', async () => {
    const zenon = Zenon.getInstance()
    Zenon.setChainID(CHAIN_ID)
    await zenon.initialize(RPC)
    const keyPair = KeyStore.fromMnemonic(MNEMONIC).getKeyPair(0)
    const address = keyPair.getAddress()

    // Receive whatever the faucet sent, so the balance is spendable.
    const pending = await zenon.ledger.getUnreceivedBlocksByAddress(address, 0, 10)
    for (const block of pending.list) {
      await zenon.send(AccountBlockTemplate.receive(block.hash), keyPair)
    }

    const sentinel = zenon.embedded.sentinel
    const before = await sentinel.getDepositedQsr(address)

    await zenon.send(buildDepositQsrBlock('sentinel', ONE_QSR), keyPair)
    const deposited = await until(() => sentinel.getDepositedQsr(address), (v) => v === before + ONE_QSR)
    expect(deposited).toBe(before + ONE_QSR)

    await zenon.send(sentinel.withdrawQsr(), keyPair)
    const after = await until(() => sentinel.getDepositedQsr(address), (v) => v === 0n)
    expect(after).toBe(0n)
  }, 900_000)
})
