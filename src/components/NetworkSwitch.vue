<script setup lang="ts">
import {ref} from 'vue'
import {useNetwork} from '@/core'
import {isSendBusy} from '@/core/send-status'
import {NETWORKS} from '@/core/networks'
import type {NetworkKey} from '@/core/networks'
import {Button, useToast} from 'nom-ui'

const network = useNetwork()
const toast = useToast()
const switching = ref<NetworkKey | null>(null)

async function select(key: NetworkKey) {
  if (network.activeNetwork.value?.key === key || switching.value) return
  switching.value = key
  try {
    await network.switchNetwork(key)
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Could not switch network', 'error')
    switching.value = null
  }
}
</script>

<template>
  <div class="space-y-2 rounded-md border p-3">
    <div class="text-sm font-medium">Network</div>
    <div class="grid grid-cols-2 gap-2" role="group" aria-label="Network">
      <Button
        v-for="n in NETWORKS"
        :key="n.key"
        type="button"
        size="sm"
        :variant="network.activeNetwork.value?.key === n.key ? 'default' : 'outline'"
        :aria-pressed="network.activeNetwork.value?.key === n.key"
        :disabled="!!switching || isSendBusy"
        @click="select(n.key)"
      >
        {{ switching === n.key ? 'Switching…' : n.label }}
      </Button>
    </div>
    <p class="text-xs text-muted-foreground">
      Your wallets and addresses are the same on both networks. Switching connects to a
      {{ network.activeNetwork.value?.key === 'testnet' ? 'mainnet' : 'testnet' }} node and reloads
      the wallet, so you'll need to unlock again.
      <template v-if="network.activeNetwork.value?.key === 'testnet'">
        Testnet funds: <a :href="NETWORKS.testnet.faucet" target="_blank" rel="noopener noreferrer" class="underline">faucet</a>.
      </template>
    </p>
  </div>
</template>
