import {validateMnemonic} from '@scure/bip39'
import {wordlist} from '@scure/bip39/wordlists/english'

/** BIP39 English list, the one Zenon (Syrius, the SDK) uses. */
export const WORDS: readonly string[] = wordlist
const WORD_SET = new Set(wordlist)

export type WordState = 'empty' | 'valid' | 'invalid'

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase()
}

/** Split pasted or typed text into words (any whitespace, commas, numbered lists). */
export function splitPhrase(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\d+[.)]/g, ' ') // "1. word 2) word"
    .split(/[\s,;]+/)
    .map((w) => w.replace(/[^a-z]/g, '')) // stray punctuation, e.g. "zoo."
    .filter(Boolean)
}

export function wordState(word: string): WordState {
  const w = normalizeWord(word)
  if (!w) return 'empty'
  return WORD_SET.has(w) ? 'valid' : 'invalid'
}

/** Up to `limit` list words starting with what was typed, for suggestions. */
export function suggestions(prefix: string, limit = 6): string[] {
  const p = normalizeWord(prefix)
  if (p.length < 1) return []
  const out: string[] = []
  for (const w of wordlist) {
    if (w.startsWith(p)) out.push(w)
    if (out.length >= limit) break
  }
  return out
}

export type PhraseStatus =
  | { kind: 'incomplete'; filled: number; length: number }
  | { kind: 'unknown-words'; positions: number[] }
  | { kind: 'wrong-length'; count: number }
  | { kind: 'bad-checksum' }
  | { kind: 'valid'; phrase: string }

/** Whole-phrase check: every word on the list, 12 or 24 words, BIP39 checksum. */
export function phraseStatus(words: string[], length?: 12 | 24): PhraseStatus {
  const normalized = words.map(normalizeWord)
  const unknown = normalized.flatMap((w, i) => (w && !WORD_SET.has(w) ? [i + 1] : []))
  if (unknown.length) return { kind: 'unknown-words', positions: unknown }
  const filled = normalized.filter(Boolean)
  if (length !== undefined) {
    if (filled.length < length) return { kind: 'incomplete', filled: filled.length, length }
  } else if (filled.length === 0) {
    return { kind: 'incomplete', filled: 0, length: 12 }
  } else if (filled.length !== 12 && filled.length !== 24) {
    return filled.length < 24 && filled.length !== 0 && filled.length < 12
      ? { kind: 'incomplete', filled: filled.length, length: 12 }
      : { kind: 'wrong-length', count: filled.length }
  }
  const phrase = filled.join(' ')
  return validateMnemonic(phrase, wordlist) ? { kind: 'valid', phrase } : { kind: 'bad-checksum' }
}
