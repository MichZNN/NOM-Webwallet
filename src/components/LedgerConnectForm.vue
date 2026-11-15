<script setup lang="ts">
import {ref} from 'vue'
import {useWallet} from '@/core'
import {disconnectLedger, getLedgerApp, isLedgerSupported} from '@/core/ledger/connection'
import {Button, Field, FieldDescription, FieldGroup, FieldLabel, Input} from 'nom-ui'

const emit = defineEmits<{
  success: [walletAddress: string]
  cancel: []
}>()

const wallet = useWallet()
const name = ref('')
const step = ref<'idle' | 'connecting' | 'confirm'>('idle')
const errorMessage = ref<string | null>(null)
const supported = isLedgerSupported() || import.meta.env.DEV

async function connect() {
  errorMessage.value = null
  step.value = 'connecting'
  try {
    // Must run from this click: the browser shows its device chooser.
    const app = await getLedgerApp()
    await app.ensureZenonApp()
    step.value = 'confirm'
    // The user checks the address on the device screen before it is added.
    const publicKey = await app.publicKey(0, true)
    const added = await wallet.addLedgerWallet(Buffer.from(publicKey).toString('hex'), name.value.trim() || undefined)
    emit('success', added.baseAddress)
  } catch (err) {
    await disconnectLedger()
    errorMessage.value = err instanceof Error ? err.message : 'Could not connect to the Ledger'
    step.value = 'idle'
  }
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="!supported" class="text-sm text-destructive">
      This browser can't connect to a Ledger. Use Chrome, Edge or Brave on a computer.
    </p>
    <FieldGroup v-else>
      <Field>
        <FieldLabel for="ledger-wallet-name">Wallet Name (optional)</FieldLabel>
        <Input id="ledger-wallet-name" v-model="name" placeholder="Ledger" :disabled="step !== 'idle'" />
      </Field>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Connect your Ledger and unlock it.</li>
        <li>Open the <strong>Zenon</strong> app on it.</li>
        <li>Click Connect and pick the device.</li>
        <li>Check that the address on the Ledger matches, then approve.</li>
      </ol>
      <FieldDescription>
        Your keys stay on the Ledger; every transaction is confirmed on the device. P2P swaps and
        signing messages for dApps are not available with a Ledger.
      </FieldDescription>
      <p v-if="step === 'confirm'" class="text-sm font-medium">Confirm the address on your Ledger…</p>
      <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>
      <div class="flex gap-3">
        <Button type="button" variant="outline" class="flex-1" :disabled="step !== 'idle'" @click="emit('cancel')">
          Cancel
        </Button>
        <Button type="button" class="flex-1" :disabled="step !== 'idle'" @click="connect">
          {{ step === 'idle' ? 'Connect Ledger' : 'Waiting for the Ledger…' }}
        </Button>
      </div>
    </FieldGroup>
  </div>
</template>
