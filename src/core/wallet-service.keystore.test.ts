import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, WalletStorage } from '@/types'

vi.mock('@/core/session-manager', () => ({
  sessionManager: { unlock: vi.fn(), lock: vi.fn() },
}))

const { WalletService } = await import('@/core/wallet-service')

const SYRIUS_FILE = readFileSync(new URL('./__fixtures__/syrius-keystore.json', import.meta.url), 'utf8')
const PASSWORD = 'Syrius-Test-Password!'
const BASE_ADDRESS = 'z1qztvt7z2ydfuwsfdfupjlfl5duw0w9ct8aulct'

let stored: WalletStorage | null
const storage = {
  get: async () => structuredClone(stored),
  set: async (_key: string, value: WalletStorage) => {
    stored = structuredClone(value)
  },
} as unknown as StorageAdapter

beforeEach(() => {
  stored = null
})

describe('WalletService keystore files', () => {
  it('imports a Syrius keystore and re-encrypts it with the stronger KDF', async () => {
    const wallet = await new WalletService(storage).importKeystore(SYRIUS_FILE, PASSWORD, 'Old')

    expect(wallet.baseAddress).toBe(BASE_ADDRESS)
    expect(stored?.wallets).toHaveLength(1)
    expect(stored?.wallets[0].name).toBe('Old')
    expect(stored?.wallets[0].encryptedKeyFile.crypto.argon2Params.timeCost).toBe(3)
  })

  it('rejects a wrong keystore password', async () => {
    await expect(
      new WalletService(storage).importKeystore(SYRIUS_FILE, 'wrong')
    ).rejects.toThrow('Incorrect password for this keystore file')
    expect(stored).toBeNull()
  })

  it('refuses to add the same wallet twice', async () => {
    const service = new WalletService(storage)
    await service.importKeystore(SYRIUS_FILE, PASSWORD)

    await expect(service.importKeystore(SYRIUS_FILE, PASSWORD)).rejects.toThrow(
      'already been added'
    )
    expect(stored?.wallets).toHaveLength(1)
  })

  it('exports with the wallet password only', async () => {
    const service = new WalletService(storage)
    await service.importKeystore(SYRIUS_FILE, PASSWORD)

    await expect(service.exportKeystore(BASE_ADDRESS, 'wrong')).rejects.toThrow(
      'Incorrect password'
    )
    const file = await service.exportKeystore(BASE_ADDRESS, PASSWORD)
    expect(file.baseAddress).toBe(BASE_ADDRESS)
    expect(file.walletType).toBe('keystore')
  })
})
