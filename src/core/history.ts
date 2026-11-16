/**
 * Turns an account's blocks into history rows. Takes the AccountBlock fields
 * it reads structurally, so it runs under unit tests without a node.
 */

// Network protocol constants (go-zenon common/types). Cannot change without a chain fork.
const USER_SEND = 2
const USER_RECEIVE = 3
const CONTRACT_SEND = 4
const CONTRACT_RECEIVE = 5

export interface HistoryBlock {
  blockType: number
  hash: { toString(): string }
  height: number
  address: { toString(): string }
  toAddress: { toString(): string }
  amount: { toString(): string }
  token?: { symbol: string; decimals: number; tokenStandard: { toString(): string } } | null
  data: Uint8Array
  confirmationDetail?: { momentumTimestamp: number } | null
  pairedAccountBlock?: HistoryBlock | null
}

export type DecodeCall = (toAddress: string, data: Uint8Array) => { contract: string; method: string } | null

export interface HistoryEntry {
  hash: string
  height: number
  direction: 'in' | 'out'
  /** Who sent (in) or received (out); the contract for a contract call. */
  counterparty: string
  /** Raw amount in base units; '0' when nothing moved. */
  amount: string
  symbol: string | null
  decimals: number
  tokenStandard: string | null
  /** e.g. 'Plasma · Fuse' for embedded contract calls, else null. */
  action: string | null
  /** Momentum time (Unix seconds), null while unconfirmed. */
  timestamp: number | null
}

export function toHistoryEntry(block: HistoryBlock, decode?: DecodeCall): HistoryEntry | null {
  const isSend = block.blockType === USER_SEND || block.blockType === CONTRACT_SEND
  const isReceive = block.blockType === USER_RECEIVE || block.blockType === CONTRACT_RECEIVE
  // Genesis and unknown block types move nothing the user did.
  if (!isSend && !isReceive) return null

  // A receive block carries no value itself: the amount and token are on the
  // send block it pairs with.
  const source = isReceive && block.pairedAccountBlock ? block.pairedAccountBlock : block
  const counterparty = isSend
    ? block.toAddress.toString()
    : (block.pairedAccountBlock?.address.toString() ?? '')

  let action: string | null = null
  if (isSend && decode && block.data.length > 0) {
    const call = decode(block.toAddress.toString(), block.data)
    if (call) action = `${call.contract} · ${capitalize(call.method)}`
  }

  return {
    hash: block.hash.toString(),
    height: block.height,
    direction: isSend ? 'out' : 'in',
    counterparty,
    amount: source.amount.toString(),
    symbol: source.token?.symbol ?? null,
    decimals: source.token?.decimals ?? 0,
    tokenStandard: source.token?.tokenStandard.toString() ?? null,
    action,
    timestamp: block.confirmationDetail?.momentumTimestamp ?? null,
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
