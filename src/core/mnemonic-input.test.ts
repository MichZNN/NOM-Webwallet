import { describe, expect, it } from 'vitest'
import { phraseStatus, splitPhrase, suggestions, wordState } from './mnemonic-input'

const VALID_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const VALID_24 =
  'abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware'

describe('mnemonic input', () => {
  it('checks single words against the BIP39 list', () => {
    expect(wordState('')).toBe('empty')
    expect(wordState(' Abandon ')).toBe('valid')
    expect(wordState('abandn')).toBe('invalid')
  })

  it('suggests list words for a prefix', () => {
    expect(suggestions('aban')).toEqual(['abandon'])
    expect(suggestions('zo')).toEqual(['zone', 'zoo'])
    expect(suggestions('')).toEqual([])
  })

  it('splits pasted phrases, including numbered lists and commas', () => {
    expect(splitPhrase('1. abandon 2) about,zoo\n  zone')).toEqual(['abandon', 'about', 'zoo', 'zone'])
  })

  it('accepts valid 12 and 24 word phrases', () => {
    expect(phraseStatus(VALID_12.split(' '), 12)).toEqual({ kind: 'valid', phrase: VALID_12 })
    expect(phraseStatus(VALID_24.split(' '), 24)).toMatchObject({ kind: 'valid' })
    expect(phraseStatus(splitPhrase(VALID_24))).toMatchObject({ kind: 'valid' })
  })

  it('reports unknown words by position, missing words, length and checksum', () => {
    const typo = VALID_12.split(' ')
    typo[3] = 'abandn'
    expect(phraseStatus(typo, 12)).toEqual({ kind: 'unknown-words', positions: [4] })
    expect(phraseStatus(VALID_12.split(' ').slice(0, 5), 12)).toEqual({ kind: 'incomplete', filled: 5, length: 12 })
    expect(phraseStatus(Array(13).fill('abandon'))).toEqual({ kind: 'wrong-length', count: 13 })
    // All list words, wrong checksum (swapped order)
    const swapped = VALID_12.split(' ')
    ;[swapped[0], swapped[11]] = [swapped[11], swapped[0]]
    expect(phraseStatus(swapped, 12)).toEqual({ kind: 'bad-checksum' })
  })
})
