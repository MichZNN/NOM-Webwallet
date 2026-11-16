import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, Wallet, WalletStorage } from '@/types'

// A fake KeyFile whose "encrypted" form records the password, so tests can
// see which password a stored key file now opens with.
vi.mock('znn-typescript-sdk', () => ({
  KeyStore: {},
  KeyFile: {
    setPassword: (password: string) => ({
      decrypt: async (file: { password: string }) => {
        if (file.password !== password) throw new Error('bad password')
        return { keys: 'secret' }
      },
      encrypt: async () => ({ password }),
    }),
    needsUpgrade: () => false,
  },
}))
vi.mock('@/core/session-manager', () => ({ sessionManager: { unlock: vi.fn() } }))

const { WalletService } = await import('@/core/wallet-service')

function wallet(baseAddress: string, password: string): Wallet {
  return {
    name: baseAddress,
    baseAddress,
    encryptedKeyFile: { password },
    accounts: [{ address: `${baseAddress}-acc`, index: 0, label: 'Account 1' }],
    createdAt: 0,
  } as unknown as Wallet
}

let current: WalletStorage
const get = vi.fn(async () => structuredClone(current))
const set = vi.fn(async (_key: string, value: WalletStorage) => {
  current = structuredClone(value)
})
const storage = { get, set } as unknown as StorageAdapter

beforeEach(() => {
  current = {
    wallets: [wallet('z1a', 'old-pass'), wallet('z1b', 'other-pass')],
    activeWalletAddress: 'z1a',
    activeAccountAddress: 'z1a-acc',
  }
  get.mockClear()
  set.mockClear()
  get.mockImplementation(async () => structuredClone(current))
})

describe('WalletService.changePassword', () => {
  it('re-encrypts only the target wallet under the new password', async () => {
    await new WalletService(storage).changePassword('z1a', 'old-pass', 'new-pass')

    expect(set).toHaveBeenCalledTimes(1)
    expect(current.wallets[0].encryptedKeyFile).toEqual({ password: 'new-pass' })
    expect(current.wallets[1].encryptedKeyFile).toEqual({ password: 'other-pass' })
  })

  it('rejects a wrong current password and writes nothing', async () => {
    await expect(
      new WalletService(storage).changePassword('z1a', 'wrong', 'new-pass')
    ).rejects.toThrow('Current password is incorrect')
    expect(set).not.toHaveBeenCalled()
  })

  it('shares the unlock lockout after repeated wrong passwords', async () => {
    const service = new WalletService(storage)
    for (let i = 0; i < 5; i++) {
      await expect(service.changePassword('z1a', 'wrong', 'x')).rejects.toThrow()
    }
    await expect(service.changePassword('z1a', 'old-pass', 'x')).rejects.toThrow(
      /Too many attempts/
    )
    await expect(service.unlockWallet('z1a', 'old-pass')).rejects.toThrow(/Too many attempts/)
  })

  it('throws for an unknown wallet', async () => {
    await expect(
      new WalletService(storage).changePassword('z1x', 'old-pass', 'new-pass')
    ).rejects.toThrow('Wallet not found')
  })

  it('keeps changes another window saved during the encrypt', async () => {
    get
      .mockImplementationOnce(async () => structuredClone(current))
      .mockImplementationOnce(async () => {
        current = { ...current, activeWalletAddress: 'z1b', activeAccountAddress: 'z1b-acc' }
        return structuredClone(current)
      })

    await new WalletService(storage).changePassword('z1a', 'old-pass', 'new-pass')

    expect(current.activeWalletAddress).toBe('z1b')
    expect(current.wallets[0].encryptedKeyFile).toEqual({ password: 'new-pass' })
  })

  it('refuses to overwrite a key file another window replaced during the encrypt', async () => {
    get
      .mockImplementationOnce(async () => structuredClone(current))
      .mockImplementationOnce(async () => {
        current.wallets[0].encryptedKeyFile = { password: 'changed-elsewhere' } as never
        return structuredClone(current)
      })

    await expect(
      new WalletService(storage).changePassword('z1a', 'old-pass', 'new-pass')
    ).rejects.toThrow(/changed in another window/)
    expect(set).not.toHaveBeenCalled()
    expect(current.wallets[0].encryptedKeyFile).toEqual({ password: 'changed-elsewhere' })
  })
})
