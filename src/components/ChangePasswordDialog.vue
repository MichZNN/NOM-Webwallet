<script setup lang="ts">
import {computed, ref} from 'vue'
import {estimatePasswordStrength, usePasswordStrength, useWallet} from '@/core'
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
import PasswordStrengthMeter from './PasswordStrengthMeter.vue'

interface Props {
  walletAddress: string
  walletName: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()

const wallet = useWallet()
const toast = useToast()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const isSaving = ref(false)
const errorMessage = ref<string | null>(null)

const strength = usePasswordStrength(newPassword)
const passwordsMatch = computed(() => newPassword.value === confirmPassword.value)
const sameAsCurrent = computed(
  () => newPassword.value.length > 0 && newPassword.value === currentPassword.value
)
const canSubmit = computed(
  () =>
    !!currentPassword.value &&
    !!newPassword.value &&
    passwordsMatch.value &&
    !sameAsCurrent.value &&
    strength.value.meetsFloor &&
    !isSaving.value
)

async function handleSubmit() {
  if (!canSubmit.value) return
  isSaving.value = true
  errorMessage.value = null

  // Snapshot the inputs so an edit mid-await can't swap in an unscored password.
  const current = currentPassword.value
  const next = newPassword.value

  try {
    // Authoritative gate: re-score the snapshotted password.
    const finalStrength = await estimatePasswordStrength(next)
    if (!finalStrength.meetsFloor) {
      errorMessage.value = 'Please choose a stronger password'
      return
    }

    await wallet.changePassword(props.walletAddress, current, next)
    toast.show('Password changed', 'success')
    emit('close')
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'Failed to change password'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && !isSaving && emit('close')">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Change Password</DialogTitle>
        <p class="text-sm text-muted-foreground">{{ walletName }}</p>
      </DialogHeader>

      <form @submit.prevent="handleSubmit">
        <FieldGroup>
          <Field>
            <FieldLabel for="current-password">Current Password</FieldLabel>
            <Input
              id="current-password"
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              placeholder="Enter current password"
              :disabled="isSaving"
            />
          </Field>

          <Field>
            <FieldLabel for="new-password">New Password</FieldLabel>
            <Input
              id="new-password"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              placeholder="Enter new password"
              :disabled="isSaving"
            />
            <PasswordStrengthMeter v-if="newPassword" :strength="strength" class="mt-2" />
            <FieldDescription v-if="sameAsCurrent" class="text-destructive">
              The new password must differ from the current one
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel for="confirm-new-password">Confirm New Password</FieldLabel>
            <Input
              id="confirm-new-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              placeholder="Confirm new password"
              :disabled="isSaving"
            />
            <FieldDescription v-if="confirmPassword && !passwordsMatch" class="text-destructive">
              Passwords do not match
            </FieldDescription>
          </Field>

          <p v-if="errorMessage" class="text-sm text-destructive">{{ errorMessage }}</p>

          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="isSaving" @click="emit('close')">
              Cancel
            </Button>
            <Button type="submit" :disabled="!canSubmit">
              {{ isSaving ? 'Changing…' : 'Change Password' }}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </DialogContent>
  </Dialog>
</template>
