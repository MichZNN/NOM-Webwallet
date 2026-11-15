/**
 * Known networks the wallet can switch between. Addresses and keys are the same
 * on every network (a seed gives the same z1… addresses everywhere); blocks are
 * bound to one network by their chain identifier, so a testnet transaction can
 * never be replayed on mainnet.
 */

import {DEFAULT_NODES} from '@/config'

export type NetworkKey = 'mainnet' | 'testnet'

export interface NetworkPreset {
  key: NetworkKey
  label: string
  chainId: number
  /** Stored alongside the chain id; the SDK does not put it in blocks. */
  networkId: number
  /** WebSocket nodes, the first one is used when switching to this network. */
  nodes: string[]
  explorerTx: (hash: string) => string
  faucet?: string
}

export const NETWORKS: Record<NetworkKey, NetworkPreset> = {
  mainnet: {
    key: 'mainnet',
    label: 'Mainnet',
    chainId: 1,
    networkId: 1,
    nodes: DEFAULT_NODES,
    explorerTx: (hash) => `https://zenonhub.io/explorer/transaction/${hash}`,
  },
  testnet: {
    key: 'testnet',
    label: 'Testnet',
    chainId: 73404,
    networkId: 1,
    nodes: ['wss://rpc.testnet.zenon.info'],
    explorerTx: (hash) => `https://explorer.testnet.zenon.info/transaction/${hash}`,
    faucet: 'https://faucet.zenonhub.io/',
  },
}

/** The known network with this chain id, or null for a custom chain. */
export function networkForChainId(chainId: number): NetworkPreset | null {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId) ?? null
}

/** Explorer page for a transaction on the given chain; null for a custom chain. */
export function explorerTxUrl(chainId: number, hash: string): string | null {
  return networkForChainId(chainId)?.explorerTx(hash) ?? null
}
