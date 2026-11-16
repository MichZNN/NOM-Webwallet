import {KeyFile} from 'znn-typescript-sdk'
import type {KeyStore} from 'znn-typescript-sdk'
import type {KeyFileEncryptedData} from '@/types'

/**
 * Keystore files as Syrius (znn_sdk_dart EncryptedFile) reads and writes them:
 *
 *   { baseAddress, walletType: 'keystore',
 *     crypto: { argon2Params: { salt }, cipherData, cipherName, kdf, nonce },
 *     timestamp, version: 1 }
 *
 * The payload is the wallet entropy, AES-256-GCM encrypted (AAD "zenon") under
 * an Argon2id key. Syrius doesn't store the KDF params: it always uses the ones
 * below, so a file must be encrypted with exactly these to open in Syrius.
 */
export const SYRIUS_KDF = {
  timeCost: 1,
  memoryCost: 64 * 1024,
  hashLength: 32,
  parallelism: 4,
} as const

export const SYRIUS_KEYSTORE_TYPE = 'keystore'

export interface SyriusKeystoreFile {
  baseAddress: string
  walletType: typeof SYRIUS_KEYSTORE_TYPE
  crypto: {
    argon2Params: { salt: string }
    cipherData: string
    cipherName: string
    kdf: string
    nonce: string
  }
  timestamp: number
  version: number
}

const HEX = /^0x[0-9a-fA-F]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse a keystore file (Syrius, znn-cli, or this wallet's own key file format)
 * into the SDK's KeyFile shape. Throws a user-readable error for anything else.
 */
export function parseKeystoreFile(text: string): KeyFileEncryptedData {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('This is not a keystore file (invalid JSON)')
  }
  if (!isRecord(json) || !isRecord(json.crypto)) {
    throw new Error('This is not a keystore file')
  }

  const walletType = json.walletType
  if (walletType !== undefined && walletType !== SYRIUS_KEYSTORE_TYPE) {
    throw new Error(
      walletType === 'ledger'
        ? 'This is a Ledger wallet file. Ledger wallets are not supported yet.'
        : `Unsupported wallet type: ${String(walletType)}`
    )
  }

  const crypto = json.crypto
  const argon2Params = crypto.argon2Params
  if (
    typeof json.baseAddress !== 'string' ||
    !isRecord(argon2Params) ||
    typeof argon2Params.salt !== 'string' ||
    !HEX.test(argon2Params.salt) ||
    typeof crypto.cipherData !== 'string' ||
    !HEX.test(crypto.cipherData) ||
    typeof crypto.nonce !== 'string' ||
    !HEX.test(crypto.nonce)
  ) {
    throw new Error('This keystore file is incomplete or damaged')
  }
  if (crypto.cipherName !== 'aes-256-gcm' || crypto.kdf !== 'argon2.IDKey') {
    throw new Error('This keystore file uses an unsupported encryption scheme')
  }

  // Keep stored KDF params (this wallet's own format); without them the SDK
  // uses its defaults, which equal SYRIUS_KDF.
  const params: KeyFileEncryptedData['crypto']['argon2Params'] = { salt: argon2Params.salt }
  for (const key of ['timeCost', 'memoryCost', 'hashLength', 'parallelism'] as const) {
    if (typeof argon2Params[key] === 'number') params[key] = argon2Params[key]
  }

  return {
    baseAddress: json.baseAddress,
    crypto: {
      argon2Params: params,
      cipherData: crypto.cipherData,
      cipherName: crypto.cipherName,
      kdf: crypto.kdf,
      nonce: crypto.nonce,
    },
    timestamp: typeof json.timestamp === 'number' ? json.timestamp : 0,
    version: typeof json.version === 'number' ? json.version : 1,
  }
}

/** Encrypt a key store into a file Syrius can import. */
export async function toSyriusKeystoreFile(
  keyStore: KeyStore,
  password: string
): Promise<SyriusKeystoreFile> {
  const encrypted = await KeyFile.setPassword(password).encrypt(keyStore, SYRIUS_KDF)
  const { salt } = encrypted.crypto.argon2Params
  return {
    baseAddress: encrypted.baseAddress,
    walletType: SYRIUS_KEYSTORE_TYPE,
    crypto: {
      argon2Params: { salt },
      cipherData: encrypted.crypto.cipherData,
      cipherName: encrypted.crypto.cipherName,
      kdf: encrypted.crypto.kdf,
      nonce: encrypted.crypto.nonce,
    },
    timestamp: encrypted.timestamp,
    version: 1,
  }
}
