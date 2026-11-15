import { describe, expect, it } from 'vitest'
import { ACCELERATOR_ADDRESS, AcceleratorContract, Zenon, ZNN_ZTS } from 'znn-typescript-sdk'
import { buildCreateProjectBlock } from './accelerator-service'

const metadata = { name: 'P', description: 'D', url: 'https://example.com', znn: 5n, qsr: 7n }

describe('buildCreateProjectBlock', () => {
  it('pays exactly 1 ZNN to the accelerator', () => {
    const block = buildCreateProjectBlock(metadata)
    expect(block.toAddress.toString()).toBe(ACCELERATOR_ADDRESS.toString())
    expect(block.tokenStandard.toString()).toBe(ZNN_ZTS.toString())
    expect(BigInt(block.amount.toString())).toBe(100_000_000n)
    const args = AcceleratorContract.abi.decodeFunctionData('CreateProject', `0x${Buffer.from(block.data).toString('hex')}`)
    expect(args.map(String)).toEqual(['P', 'D', 'https://example.com', '5', '7'])
  })

  // Documents why the block is built here; fails once the SDK sends 1 ZNN.
  it('differs from the SDK createProject, which sends 10 base units', () => {
    const sdk = Zenon.getInstance().embedded.accelerator.createProject('P', 'D', 'https://example.com', 5n, 7n)
    expect(BigInt(sdk.amount.toString())).not.toBe(100_000_000n)
  })
})
