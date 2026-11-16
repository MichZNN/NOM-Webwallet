import {STORAGE_KEY_CHAIN_ID, STORAGE_KEY_SELECTED_NODE} from '@/config'
import {isSwitchingNetwork} from './useNetwork'

const WATCHED = [STORAGE_KEY_CHAIN_ID, STORAGE_KEY_SELECTED_NODE]
let started = false

/**
 * Reload this window when another window or tab switches network (chain id or
 * node), so it never shows or sends with a mix of two networks. The extension's
 * WalletConnect window first gets a moment to tell connected dApps about the
 * new chain (useWalletConnect syncs the chain id from storage).
 */
export function useNetworkSync(options: { isWalletConnectWindow: () => boolean }): void {
  if (started) return
  started = true

  const onChange = () => {
    if (isSwitchingNetwork.value) return // our own switch; it reloads itself
    const delay = options.isWalletConnectWindow() ? 1500 : 0
    setTimeout(() => window.location.reload(), delay)
  }

  if (__IS_EXTENSION__) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && WATCHED.some((key) => key in changes)) onChange()
    })
  } else {
    // Fires only for writes made by other tabs of the same origin.
    window.addEventListener('storage', (event) => {
      if (event.key && WATCHED.includes(event.key)) onChange()
    })
  }
}
