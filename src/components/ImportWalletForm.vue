<script setup lang="ts">
import {computed, ref} from 'vue'
import {estimatePasswordStrength, usePasswordStrength, useWallet} from '@/core'
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  useToast,
} from 'nom-ui'
import {EyeIcon, EyeOffIcon} from 'lucide-vue-next'
import PasswordStrengthMeter from './PasswordStrengthMeter.vue'
import ImportKeystoreForm from './ImportKeystoreForm.vue'
import {LEDGER_ENABLED} from '@/config'
import LedgerConnectForm from './LedgerConnectForm.vue'
import MnemonicInput from './MnemonicInput.vue'

const emit = defineEmits<{
  success: [walletAddress: string]
  cancel: []
}>()

const wallet = useWallet()
const toast = useToast()

const source = ref<'phrase' | 'keystore' | 'ledger'>('phrase')
const name = ref('')
const mnemonic = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const isImporting = ref(false)

// Set by MnemonicInput only once the phrase is complete with a valid checksum.
const mnemonicValid = computed(() => mnemonic.value !== '')
const passwordsMatch = computed(() => password.value === confirmPassword.value)
const strength = usePasswordStrength(password)
const passwordStrong = computed(() => strength.value.meetsFloor)
const canSubmit = computed(
  () => mnemonicValid.value && passwordStrong.value && passwordsMatch.value && !isImporting.value
)

async function handleImport() {
  if (!canSubmit.value) return

  // Guard re-entry before any await so a fast double-click can't start two
  // concurrent imports while the password is being (re-)scored.
  if (isImporting.value) return
  isImporting.value = true
  try {
    // Snapshot the inputs before any await. Fields stay editable during scoring,
    // so we must validate and import with the exact values submitted — never
    // re-read password.value later, or an edit mid-await could swap in a weaker
    // password than the one we scored.
    const pw = password.value
    const mnemonicValue = mnemonic.value.trim()
    const walletName = name.value || 'Imported Wallet'

    // Authoritative gate: re-score the snapshotted password.
    const finalStrength = await estimatePasswordStrength(pw)
    if (!finalStrength.meetsFloor) {
      toast.show('Please choose a stronger password', 'warning')
      return
    }

    const importedWallet = await wallet.importWallet(mnemonicValue, pw, walletName)
    emit('success', importedWallet.baseAddress)
  } catch (error) {
    console.error('Failed to import wallet:', error)
    const duplicate = error instanceof Error && error.message.includes('already been added')
    toast.show(
      duplicate
        ? error.message
        : 'Failed to import wallet. Please check your recovery phrase and try again.',
      'error'
    )
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="mb-2 text-2xl font-bold">Import Wallet</h2>
      <p class="mb-4 text-sm text-muted-foreground">
        {{
          source === 'phrase'
            ? 'Enter your recovery phrase to restore your wallet'
            : source === 'keystore'
              ? 'Open a keystore file to restore your wallet'
              : 'Use the accounts of your Ledger hardware wallet'
        }}
      </p>
      <div
        class="mb-2 grid gap-2"
        :class="LEDGER_ENABLED ? 'grid-cols-3' : 'grid-cols-2'"
        role="group"
        aria-label="Import from"
      >
        <Button
          type="button"
          size="sm"
          :variant="source === 'phrase' ? 'default' : 'outline'"
          :aria-pressed="source === 'phrase'"
          @click="source = 'phrase'"
        >
          Recovery Phrase
        </Button>
        <Button
          type="button"
          size="sm"
          :variant="source === 'keystore' ? 'default' : 'outline'"
          :aria-pressed="source === 'keystore'"
          @click="source = 'keystore'"
        >
          Keystore File
        </Button>
        <Button
          v-if="LEDGER_ENABLED"
          type="button"
          size="sm"
          :variant="source === 'ledger' ? 'default' : 'outline'"
          :aria-pressed="source === 'ledger'"
          @click="source = 'ledger'"
        >
          Ledger
        </Button>
      </div>
    </div>

    <LedgerConnectForm
      v-if="source === 'ledger'"
      @success="(address) => emit('success', address)"
      @cancel="emit('cancel')"
    />

    <ImportKeystoreForm
      v-else-if="source === 'keystore'"
      @success="(address) => emit('success', address)"
      @cancel="emit('cancel')"
    />

    <FieldGroup v-else>
      <Field>
        <FieldLabel for="import-wallet-name">Wallet Name (optional)</FieldLabel>
        <Input id="import-wallet-name" v-model="name" placeholder="Imported Wallet" />
      </Field>

      <Field>
        <FieldLabel>Recovery Phrase</FieldLabel>
        <MnemonicInput @phrase="(p) => (mnemonic = p ?? '')" />
      </Field>

      <!-- The password is only asked for once the phrase is right. -->
      <template v-if="mnemonicValid">

      <Field>
        <FieldLabel for="import-password">Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="import-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="Enter password"
            name="password"
            autocomplete="new-password"
            autocapitalize="off"
            spellcheck="false"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              variant="invisible"
              type="button"
              size="icon-xs"
              tabindex="-1"
              @click.stop="showPassword = !showPassword"
            >
              <EyeIcon
                v-if="!showPassword"
                class="h-4 w-4 text-muted-foreground hover:bg-transparent hover:text-foreground"
              />
              <EyeOffIcon
                v-else
                class="h-4 w-4 text-muted-foreground hover:bg-transparent hover:text-foreground"
              />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <PasswordStrengthMeter v-if="password" :strength="strength" class="mt-2" />
      </Field>

      <Field>
        <FieldLabel for="import-confirm-password">Confirm Password</FieldLabel>
        <Input
          id="import-confirm-password"
          v-model="confirmPassword"
          type="password"
          placeholder="Confirm password"
          name="password"
          autocomplete="new-password"
          autocapitalize="off"
          spellcheck="false"
        />
        <FieldDescription v-if="confirmPassword && !passwordsMatch" class="text-destructive">
          Passwords do not match
        </FieldDescription>
      </Field>

      </template>

      <div class="flex gap-3">
        <Button variant="outline" class="flex-1" @click="emit('cancel')">Cancel</Button>
        <Button class="flex-1" :disabled="!canSubmit" @click="handleImport">
          {{ isImporting ? 'Importing...' : 'Import Wallet' }}
        </Button>
      </div>
    </FieldGroup>
  </div>
</template>
