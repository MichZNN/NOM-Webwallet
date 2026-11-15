<script setup lang="ts">
import {ref} from 'vue'
import {useWallet} from '@/core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  useToast,
} from 'nom-ui'

const props = defineProps<{
  walletAddress: string
  walletName: string
}>()

const emit = defineEmits<{
  close: []
}>()

const wallet = useWallet()
const toast = useToast()

const password = ref('')
const isExporting = ref(false)
const errorMessage = ref<string | null>(null)

function download(fileName: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function handleExport() {
  if (!password.value || isExporting.value) return
  isExporting.value = true
  errorMessage.value = null
  try {
    const file = await wallet.exportKeystore(props.walletAddress, password.value)
    // Syrius names keystore files after the base address.
    download(`${file.baseAddress}.json`, JSON.stringify(file))
    toast.show('Keystore file exported', 'success')
    emit('close')
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to export keystore file'
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && !isExporting && emit('close')">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Export Keystore File</DialogTitle>
        <p class="text-sm text-muted-foreground">{{ walletName }}</p>
      </DialogHeader>

      <form @submit.prevent="handleExport">
        <FieldGroup>
          <Field>
            <FieldLabel for="export-keystore-password">Wallet Password</FieldLabel>
            <Input
              id="export-keystore-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="Enter wallet password"
              :disabled="isExporting"
            />
            <FieldDescription>
              The file is encrypted with this password, in the format Syrius and znn-cli use. That
              format has a weaker key derivation than this wallet's own storage, so keep the file
              private.
            </FieldDescription>
          </Field>

          <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>

          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="isExporting" @click="emit('close')">
              Cancel
            </Button>
            <Button type="submit" :disabled="!password || isExporting">
              {{ isExporting ? 'Exporting…' : 'Export' }}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>
</template>
