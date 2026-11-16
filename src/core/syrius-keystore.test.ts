import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KeyFile, KeyStore } from 'znn-typescript-sdk'
import { parseKeystoreFile, toSyriusKeystoreFile } from './syrius-keystore'

// Made outside this codebase, the way znn_sdk_dart's EncryptedFile does it
// (Argon2id t=1 m=64MiB p=4, AES-256-GCM with AAD "zenon", tag appended).
const SYRIUS_FILE = readFileSync(new URL('./__fixtures__/syrius-keystore.json', import.meta.url), 'utf8')
const SYRIUS_PASSWORD = 'Syrius-Test-Password!'
const ENTROPY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const BASE_ADDRESS = 'z1qztvt7z2ydfuwsfdfupjlfl5duw0w9ct8aulct'

describe('parseKeystoreFile', () => {
  it('opens a Syrius keystore file with its password', async () => {
    const keyFile = parseKeystoreFile(SYRIUS_FILE)
    const keyStore = await KeyFile.setPassword(SYRIUS_PASSWORD).decrypt(keyFile)

    expect(keyStore.entropy).toBe(ENTROPY)
    expect(keyStore.getBaseAddress().toString()).toBe(BASE_ADDRESS)
  })

  it('rejects the wrong password', async () => {
    const keyFile = parseKeystoreFile(SYRIUS_FILE)
    await expect(KeyFile.setPassword('wrong').decrypt(keyFile)).rejects.toThrow()
  })

  it('keeps KDF params stored by this wallet', () => {
    const json = JSON.parse(SYRIUS_FILE)
    json.crypto.argon2Params.timeCost = 3
    delete json.walletType

    expect(parseKeystoreFile(JSON.stringify(json)).crypto.argon2Params).toMatchObject({
      timeCost: 3,
    })
  })

  it.each([
    ['not json', /invalid JSON/],
    ['[]', /not a keystore file/],
    ['{"crypto":{}}', /incomplete or damaged/],
  ])('rejects %s', (text, error) => {
    expect(() => parseKeystoreFile(text)).toThrow(error)
  })

  it('rejects Ledger wallet files', () => {
    const json = { ...JSON.parse(SYRIUS_FILE), walletType: 'ledger' }
    expect(() => parseKeystoreFile(JSON.stringify(json))).toThrow(/Ledger/)
  })

  it('rejects other encryption schemes', () => {
    const json = JSON.parse(SYRIUS_FILE)
    json.crypto.cipherName = 'aes-128-ctr'
    expect(() => parseKeystoreFile(JSON.stringify(json))).toThrow(/unsupported encryption/)
  })
})

describe('toSyriusKeystoreFile', () => {
  it('writes the Syrius layout without KDF params, and reads back', async () => {
    const keyStore = KeyStore.fromEntropy(ENTROPY)
    const file = await toSyriusKeystoreFile(keyStore, 'Export-Password-1')

    expect(file.walletType).toBe('keystore')
    expect(file.baseAddress).toBe(BASE_ADDRESS)
    expect(Object.keys(file.crypto.argon2Params)).toEqual(['salt'])

    // Without stored params the SDK decrypts with Syrius' fixed ones, so this
    // only succeeds if the file was encrypted with exactly those.
    const reopened = await KeyFile.setPassword('Export-Password-1').decrypt(
      parseKeystoreFile(JSON.stringify(file))
    )
    expect(reopened.entropy).toBe(ENTROPY)
  })
})
