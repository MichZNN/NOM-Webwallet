<script setup lang="ts">
import {computed, ref} from 'vue'
import {usePasswordStrength, useWallet} from '@/core'
import {Button, Field, FieldDescription, FieldGroup, FieldLabel, Input} from 'nom-ui'
import PasswordStrengthMeter from './PasswordStrengthMeter.vue'

const emit = defineEmits<{
  success: [walletAddress: string]
  cancel: []
}>()

/** Keystore files are a few hundred bytes; anything big is not one. */
const MAX_FILE_BYTES = 64 * 1024

const wallet = useWallet()

const name = ref('')
const fileName = ref('')
const fileText = ref('')
const password = ref('')
const isImporting = ref(false)
const errorMessage = ref<string | null>(null)

const strength = usePasswordStrength(password)
const canSubmit = computed(() => !!fileText.value && !!password.value && !isImporting.value)

async function handleFile(event: Event) {
  errorMessage.value = null
  fileText.value = ''
  const file = (event.target as HTMLInputElement).files?.[0]
  fileName.value = file?.name ?? ''
  if (!file) return
  if (file.size > MAX_FILE_BYTES) {
    errorMessage.value = 'This file is too large to be a keystore file'
    return
  }
  fileText.value = await file.text()
}

async function handleImport() {
  if (!canSubmit.value) return
  isImporting.value = true
  errorMessage.value = null
  try {
    const imported = await wallet.importKeystore(
      fileText.value,
      password.value,
      name.value.trim() || undefined
    )
    emit('success', imported.baseAddress)
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to import keystore file'
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="handleImport">
    <FieldGroup>
      <Field>
        <FieldLabel for="keystore-wallet-name">Wallet Name (optional)</FieldLabel>
        <Input id="keystore-wallet-name" v-model="name" placeholder="Imported Wallet" />
      </Field>

      <Field>
        <FieldLabel for="keystore-file">Keystore File</FieldLabel>
        <Input id="keystore-file" type="file" :disabled="isImporting" @change="handleFile" />
        <FieldDescription>
          A wallet file exported from Syrius or znn-cli. Ledger wallet files are not supported.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel for="keystore-password">Keystore Password</FieldLabel>
        <Input
          id="keystore-password"
          v-model="password"
          type="password"
          placeholder="Password of the keystore file"
          autocomplete="current-password"
          :disabled="isImporting"
          @input="errorMessage = null"
        />
        <PasswordStrengthMeter v-if="password" :strength="strength" class="mt-2" />
        <FieldDescription>
          The wallet keeps this password. You can change it later in Settings.
          <span v-if="password && !strength.meetsFloor" class="text-warning">
            This password is weak; consider changing it after import.
          </span>
        </FieldDescription>
      </Field>

      <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>

      <div class="flex gap-3">
        <Button type="button" variant="outline" class="flex-1" @click="emit('cancel')">
          Cancel
        </Button>
        <Button type="submit" class="flex-1" :disabled="!canSubmit">
          {{ isImporting ? 'Importing...' : 'Import Wallet' }}
        </Button>
      </div>
    </FieldGroup>
  </form>
</template>
