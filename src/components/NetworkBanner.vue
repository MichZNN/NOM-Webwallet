<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue'
import {useNetwork} from '@/core'
import {useToast} from 'nom-ui'

/**
 * Always-visible strip when the wallet is not on mainnet, or when the node is on
 * a different chain than the wallet expects. Sits above every page and dialog;
 * the global style below pushes the app and its full-screen pages under it.
 */
const network = useNetwork()
const toast = useToast()
const switching = ref(false)
const el = ref<HTMLElement | null>(null)

const mode = computed<'mismatch' | 'testnet' | 'custom' | null>(() => {
  if (network.chainMismatch.value) return 'mismatch'
  const known = network.activeNetwork.value
  if (!known) return 'custom'
  return known.key === 'testnet' ? 'testnet' : null
})

// Publish the banner's real height (it wraps in the narrow extension popup).
const root = document.documentElement
const observer = new ResizeObserver(([entry]) => {
  root.style.setProperty('--network-banner-height', `${entry.target.getBoundingClientRect().height}px`)
})
watch(
  el,
  (node, previous) => {
    if (previous) observer.unobserve(previous)
    if (node) observer.observe(node)
    root.classList.toggle('has-network-banner', !!node)
    if (!node) root.style.removeProperty('--network-banner-height')
  },
  { flush: 'post' }
)
onBeforeUnmount(() => {
  observer.disconnect()
  root.classList.remove('has-network-banner')
})

async function backToMainnet() {
  switching.value = true
  try {
    await network.switchNetwork('mainnet')
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Could not switch to mainnet', 'error')
    switching.value = false
  }
}
</script>

<template>
  <div
    v-if="mode"
    ref="el"
    role="status"
    class="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-1.5 text-center text-xs font-semibold"
    :class="mode === 'mismatch' ? 'bg-destructive text-white' : 'bg-warning text-black'"
  >
    <template v-if="mode === 'testnet'">
      <span>TESTNET · tokens have no value</span>
      <a
        v-if="network.activeNetwork.value?.faucet"
        :href="network.activeNetwork.value.faucet"
        target="_blank"
        rel="noopener noreferrer"
        class="underline"
      >
        Faucet
      </a>
    </template>
    <span v-else-if="mode === 'custom'">Custom network · chain {{ network.chainId.value }}</span>
    <template v-else>
      <span>
        Node is on chain {{ network.nodeChainId.value }}, wallet expects {{ network.chainId.value }}
      </span>
      <button
        type="button"
        class="rounded border border-current px-2 py-0.5 hover:bg-black/10 disabled:opacity-50"
        :disabled="switching"
        @click="backToMainnet"
      >
        {{ switching ? 'Switching…' : 'Switch to mainnet' }}
      </button>
    </template>
  </div>
</template>

<style>
/* Global on purpose: push the app and its full-screen pages below the banner. */
:root.has-network-banner body {
  box-sizing: border-box;
  padding-top: var(--network-banner-height, 2rem);
}
:root.has-network-banner .min-h-screen {
  min-height: calc(100vh - var(--network-banner-height, 2rem));
}
:root.has-network-banner header.sticky.top-0 {
  top: var(--network-banner-height, 2rem);
}
:root.has-network-banner .fixed.inset-0 {
  top: var(--network-banner-height, 2rem);
}
/* Tooltips, popovers and menus open near the top edge too: keep them above the strip. */
:root.has-network-banner [data-reka-popper-content-wrapper] {
  z-index: 101 !important;
}
</style>
