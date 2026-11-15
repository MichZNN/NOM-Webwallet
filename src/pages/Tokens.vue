<script setup lang="ts">
import {computed, inject, onMounted, reactive, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {Address as SdkAddress, ZNN_ZTS} from 'znn-typescript-sdk'
import type {Token} from 'znn-typescript-sdk'
import {useAccount, useTokenAdmin, useWallet} from '@/core'
import type {Wallet} from '@/types'
import {
  TOKEN_ISSUE_FEE,
  formatAmount,
  mintableRemaining,
  parseAmount,
  validateIssue,
} from '@/core/token-rules'
import type {IssueInput} from '@/core/token-rules'
import {
  Address,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Heading,
  Input,
  Skeleton,
  useToast,
} from 'nom-ui'
import {ArrowLeftIcon} from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const requestUnlock = inject<(path?: string) => void>('requestUnlock', () => router.push('/'))

const wallet = useWallet()
const address = computed(() => wallet.activeAccountAddress.value)
const account = useAccount(() => address.value)
const admin = useTokenAdmin(() => address.value)

function balanceOf(zts: string): bigint {
  const b = account.balances.value.find((x) => x.tokenStandard === zts)
  return b ? BigInt(b.balance.toString()) : 0n
}
const znnBalance = computed(() => balanceOf(ZNN_ZTS.toString()))

function load() {
  void admin.load()
  void account.loadBalances()
}
onMounted(load)
watch(address, load)

async function act(action: (w: Wallet) => Promise<void>, success: string): Promise<boolean> {
  const active = wallet.activeWallet.value
  if (!wallet.isActiveWalletUnlocked.value || !active) {
    requestUnlock('/tokens')
    return false
  }
  try {
    await action(active)
    toast.show(success, 'success')
    void account.loadBalances()
    return true
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Transaction failed', 'error')
    return false
  }
}

// --- Issue ---
const showIssue = ref(false)
const issueForm = reactive<IssueInput>({
  name: '',
  symbol: '',
  domain: '',
  decimals: 8,
  totalSupply: '',
  maxSupply: '',
  mintable: false,
  burnable: true,
  utility: true,
})
const issueCheck = computed(() => validateIssue(issueForm))
const issueTouched = ref(false)
const canPayFee = computed(() => znnBalance.value >= TOKEN_ISSUE_FEE)

async function submitIssue() {
  issueTouched.value = true
  const params = issueCheck.value.params
  if (!params || !canPayFee.value) return
  if (await act((w) => admin.issue(w, params), `${params.symbol} issued`)) {
    showIssue.value = false
    issueTouched.value = false
  }
}

// --- Mint / burn / manage ---
type Action = { kind: 'mint' | 'burn' | 'manage'; token: Token }
const action = ref<Action | null>(null)
const amountText = ref('')
const receiver = ref('')
const newOwner = ref('')
const keepMintable = ref(true)
const burnable = ref(true)

function open(kind: Action['kind'], token: Token) {
  action.value = { kind, token }
  amountText.value = ''
  receiver.value = address.value ?? ''
  newOwner.value = token.owner.toString()
  keepMintable.value = token.isMintable
  burnable.value = token.isBurnable
}

const remaining = (t: Token) =>
  mintableRemaining(BigInt(t.totalSupply.toString()), BigInt(t.maxSupply.toString()))

const actionError = computed(() => {
  const a = action.value
  if (!a) return null
  if (a.kind === 'manage') {
    try {
      SdkAddress.parse(newOwner.value.trim())
      return null
    } catch {
      return 'Not a valid z1… owner address'
    }
  }
  const amount = parseAmount(amountText.value, a.token.decimals)
  if (amount === null || amount === 0n) return `An amount with at most ${a.token.decimals} decimals`
  if (a.kind === 'mint') {
    if (amount > remaining(a.token)) return 'More than can still be minted'
    try {
      SdkAddress.parse(receiver.value.trim())
    } catch {
      return 'Not a valid z1… receiver address'
    }
  }
  if (a.kind === 'burn' && amount > balanceOf(a.token.tokenStandard.toString())) {
    return 'More than this account holds'
  }
  return null
})

const ownerChanging = computed(
  () => action.value?.kind === 'manage' && newOwner.value.trim() !== action.value.token.owner.toString()
)
const manageChanged = computed(() => {
  const a = action.value
  if (!a || a.kind !== 'manage') return false
  return ownerChanging.value || keepMintable.value !== a.token.isMintable || burnable.value !== a.token.isBurnable
})

async function submitAction() {
  const a = action.value
  if (!a || actionError.value) return
  const t = a.token
  let ok = false
  const amount = parseAmount(amountText.value, t.decimals)
  if (a.kind === 'mint' && amount !== null) {
    ok = await act((w) => admin.mint(w, t, amount, receiver.value.trim()), `Minted ${t.symbol}`)
  } else if (a.kind === 'burn' && amount !== null) {
    ok = await act((w) => admin.burn(w, t, amount), `Burned ${t.symbol}`)
  } else if (manageChanged.value) {
    ok = await act(
      (w) => admin.update(w, t, newOwner.value.trim(), keepMintable.value, burnable.value),
      `${t.symbol} updated`
    )
  }
  if (ok) action.value = null
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button variant="outline" title="Go back" @click="router.push('/')">
          <ArrowLeftIcon />
        </Button>
        <Heading as="h1">My Tokens</Heading>
      </div>
    </div>

    <div class="container mx-auto max-w-3xl space-y-6 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          ZTS tokens owned by <Address v-if="address" :address="address" :copy="false" />
        </p>
        <Button :disabled="admin.isBusy.value" @click="showIssue = true">Issue Token</Button>
      </div>

      <Alert v-if="admin.error.value" variant="destructive">
        <AlertDescription class="flex items-center justify-between gap-2">
          <span>{{ admin.error.value }}</span>
          <Button size="sm" variant="outline" @click="load">Retry</Button>
        </AlertDescription>
      </Alert>

      <Skeleton v-if="admin.isLoading.value && !admin.tokens.value.length" class="h-28 w-full" />
      <p
        v-else-if="!admin.tokens.value.length && !admin.error.value"
        class="py-8 text-center text-muted-foreground"
      >
        This account owns no tokens yet.
      </p>

      <Card v-for="t in admin.tokens.value" :key="t.tokenStandard.toString()">
        <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Heading as="h2" class="text-lg">{{ t.symbol }}</Heading>
            <span class="text-sm text-muted-foreground">{{ t.name }}</span>
            <Badge v-if="t.isMintable" variant="outline">Mintable</Badge>
            <Badge v-if="t.isBurnable" variant="outline">Burnable</Badge>
            <Badge v-if="t.isUtility" variant="outline">Utility</Badge>
          </div>
          <div class="flex gap-2">
            <Button
              v-if="t.isMintable"
              size="sm"
              :disabled="remaining(t) === 0n || admin.isBusy.value"
              @click="open('mint', t)"
            >
              Mint
            </Button>
            <Button
              size="sm"
              variant="outline"
              :disabled="balanceOf(t.tokenStandard.toString()) === 0n || admin.isBusy.value"
              @click="open('burn', t)"
            >
              Burn
            </Button>
            <Button size="sm" variant="outline" :disabled="admin.isBusy.value" @click="open('manage', t)">
              Manage
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt class="text-muted-foreground">Token standard</dt><dd class="font-mono text-xs break-all">{{ t.tokenStandard.toString() }}</dd></div>
            <div><dt class="text-muted-foreground">Domain</dt><dd>{{ t.domain || '—' }}</dd></div>
            <div><dt class="text-muted-foreground">Total supply</dt><dd>{{ formatAmount(BigInt(t.totalSupply.toString()), t.decimals) }}</dd></div>
            <div><dt class="text-muted-foreground">Max supply</dt><dd>{{ formatAmount(BigInt(t.maxSupply.toString()), t.decimals) }}</dd></div>
            <div><dt class="text-muted-foreground">Decimals</dt><dd>{{ t.decimals }}</dd></div>
            <div><dt class="text-muted-foreground">In this account</dt><dd>{{ formatAmount(balanceOf(t.tokenStandard.toString()), t.decimals) }}</dd></div>
          </dl>
        </CardContent>
      </Card>
    </div>

    <!-- Issue dialog -->
    <Dialog :open="showIssue" @update:open="(v) => !v && !admin.isBusy.value && (showIssue = false)">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Issue Token</DialogTitle>
          <DialogDescription>
            Issuing costs 1 ZNN. Name, symbol, domain and decimals can't be changed afterwards.
          </DialogDescription>
        </DialogHeader>
        <form @submit.prevent="submitIssue">
          <FieldGroup>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel for="issue-name">Name</FieldLabel>
                <Input id="issue-name" v-model="issueForm.name" maxlength="40" />
                <FieldDescription v-if="issueTouched && issueCheck.errors.name" class="text-destructive">{{ issueCheck.errors.name }}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel for="issue-symbol">Symbol</FieldLabel>
                <Input id="issue-symbol" v-model="issueForm.symbol" maxlength="10" @input="issueForm.symbol = issueForm.symbol.toUpperCase()" />
                <FieldDescription v-if="issueTouched && issueCheck.errors.symbol" class="text-destructive">{{ issueCheck.errors.symbol }}</FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel for="issue-domain">Domain (optional)</FieldLabel>
              <Input id="issue-domain" v-model="issueForm.domain" placeholder="example.com" />
              <FieldDescription v-if="issueTouched && issueCheck.errors.domain" class="text-destructive">{{ issueCheck.errors.domain }}</FieldDescription>
            </Field>
            <div class="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel for="issue-decimals">Decimals</FieldLabel>
                <Input id="issue-decimals" v-model.number="issueForm.decimals" type="number" min="0" max="18" />
                <FieldDescription v-if="issueTouched && issueCheck.errors.decimals" class="text-destructive">{{ issueCheck.errors.decimals }}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel for="issue-total">{{ issueForm.mintable ? 'Initial supply' : 'Supply' }}</FieldLabel>
                <Input id="issue-total" v-model="issueForm.totalSupply" inputmode="decimal" />
                <FieldDescription v-if="issueTouched && issueCheck.errors.totalSupply" class="text-destructive">{{ issueCheck.errors.totalSupply }}</FieldDescription>
              </Field>
              <Field v-if="issueForm.mintable">
                <FieldLabel for="issue-max">Max supply</FieldLabel>
                <Input id="issue-max" v-model="issueForm.maxSupply" inputmode="decimal" />
                <FieldDescription v-if="issueTouched && issueCheck.errors.maxSupply" class="text-destructive">{{ issueCheck.errors.maxSupply }}</FieldDescription>
              </Field>
            </div>
            <div class="space-y-2 text-sm">
              <label class="flex items-center gap-2"><Checkbox v-model="issueForm.mintable" /> Mintable: more can be minted later, up to the max supply</label>
              <label class="flex items-center gap-2"><Checkbox v-model="issueForm.burnable" /> Burnable by any holder (the owner can always burn)</label>
              <label class="flex items-center gap-2"><Checkbox v-model="issueForm.utility" /> Utility token</label>
            </div>
            <p v-if="!canPayFee" class="text-sm text-destructive">This account needs 1 ZNN for the issue fee.</p>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="outline" :disabled="admin.isBusy.value" @click="showIssue = false">Cancel</Button>
              <Button type="submit" :disabled="admin.isBusy.value || !canPayFee || (issueTouched && !issueCheck.params)">
                Issue for 1 ZNN
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Mint / burn / manage dialog -->
    <Dialog :open="!!action" @update:open="(v) => !v && !admin.isBusy.value && (action = null)">
      <DialogContent v-if="action" class="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ action.kind === 'mint' ? 'Mint' : action.kind === 'burn' ? 'Burn' : 'Manage' }}
            {{ action.token.symbol }}
          </DialogTitle>
          <DialogDescription v-if="action.kind === 'mint'">
            Up to {{ formatAmount(remaining(action.token), action.token.decimals) }} {{ action.token.symbol }} can still be minted.
          </DialogDescription>
          <DialogDescription v-else-if="action.kind === 'burn'">
            Burned tokens are destroyed for good.
            <template v-if="!action.token.isMintable">For a fixed-supply token the max supply drops as well.</template>
          </DialogDescription>
        </DialogHeader>
        <form @submit.prevent="submitAction">
          <FieldGroup>
            <template v-if="action.kind !== 'manage'">
              <Field>
                <FieldLabel for="token-amount">Amount</FieldLabel>
                <Input id="token-amount" v-model="amountText" inputmode="decimal" />
              </Field>
              <Field v-if="action.kind === 'mint'">
                <FieldLabel for="token-receiver">Receiver</FieldLabel>
                <Input id="token-receiver" v-model="receiver" class="font-mono" />
              </Field>
            </template>
            <template v-else>
              <Field>
                <FieldLabel for="token-owner">Owner</FieldLabel>
                <Input id="token-owner" v-model="newOwner" class="font-mono" />
                <FieldDescription v-if="ownerChanging" class="text-warning">
                  Transferring ownership is final: only the new owner can mint or manage this token.
                </FieldDescription>
              </Field>
              <label class="flex items-center gap-2 text-sm">
                <Checkbox v-model="keepMintable" :disabled="!action.token.isMintable" />
                Mintable
              </label>
              <p v-if="action.token.isMintable && !keepMintable" class="text-sm text-warning">
                Turning minting off is permanent; the max supply becomes the current total supply.
              </p>
              <label class="flex items-center gap-2 text-sm">
                <Checkbox v-model="burnable" /> Burnable by any holder
              </label>
            </template>
            <p v-if="actionError && (amountText || action.kind === 'manage')" class="text-sm text-destructive">{{ actionError }}</p>
            <div class="flex justify-end gap-2">
              <Button type="button" variant="outline" :disabled="admin.isBusy.value" @click="action = null">Cancel</Button>
              <Button
                type="submit"
                :variant="action.kind === 'burn' ? 'destructive' : 'default'"
                :disabled="!!actionError || admin.isBusy.value || (action.kind === 'manage' && !manageChanged)"
              >
                {{ action.kind === 'mint' ? 'Mint' : action.kind === 'burn' ? 'Burn' : 'Save Changes' }}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
