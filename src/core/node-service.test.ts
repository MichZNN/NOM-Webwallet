import { describe, expect, it } from 'vitest'
import {
  CommonContract,
  PILLAR_ADDRESS,
  QSR_ZTS,
  SENTINEL_ADDRESS,
  Zenon,
} from 'znn-typescript-sdk'
import { buildDepositQsrBlock } from './node-service'

describe('buildDepositQsrBlock', () => {
  it.each([
    ['pillar', PILLAR_ADDRESS],
    ['sentinel', SENTINEL_ADDRESS],
  ] as const)('sends QSR to the %s contract', (contract, address) => {
    const block = buildDepositQsrBlock(contract, 5_000_000_000n)

    expect(block.toAddress.toString()).toBe(address.toString())
    expect(block.tokenStandard.toString()).toBe(QSR_ZTS.toString())
    expect(BigInt(block.amount.toString())).toBe(5_000_000_000n)
    expect(`0x${Buffer.from(block.data).toString('hex')}`).toBe(
      CommonContract.abi.encodeFunctionData('DepositQsr', [])
    )
  })

  it('rejects a zero or negative amount', () => {
    expect(() => buildDepositQsrBlock('pillar', 0n)).toThrow()
    expect(() => buildDepositQsrBlock('sentinel', -1n)).toThrow()
  })

  // Documents why the block is built here: if the SDK starts sending QSR,
  // this fails and buildDepositQsrBlock can go back to the SDK call.
  it('differs from the SDK depositQsr, which sends ZNN', () => {
    const sdkBlock = Zenon.getInstance().embedded.pillar.depositQsr(1n)
    expect(sdkBlock.tokenStandard.toString()).not.toBe(QSR_ZTS.toString())
  })
})
