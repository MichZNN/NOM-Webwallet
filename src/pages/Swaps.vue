<script setup lang="ts">
import {computed, inject, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {formatDate, useAccount, useSwaps, useWallet} from '@/core'
import type {JoinCandidate} from '@/core'
import {COUNTER_HTLC_DURATION, INITIAL_HTLC_DURATION} from '@/core/swap-rules'
import type {Swap, TokenAmount} from '@/core/swap-rules'
import {formatCooldown} from '@/core/node-rules'
import {formatAmount, parseAmount} from '@/core/token-rules'
import {Address as SdkAddress} from 'znn-typescript-sdk'
import {
  Address,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  FieldGroup,
  Heading,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from 'nom-ui'
import {ArrowLeftIcon} from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const requestUnlock = inject<(path?: string) => void>('requestUnlock', () => router.push('/'))

const wallet = useWallet()
const self = computed(() => wallet.activeAccountAddress.value)
const account = useAccount(() => self.value)
const sw = useSwaps()

onMounted(() => {
  void sw.load()
  void account.loadBalances()
})
watch(self, () => void account.loadBalances())

const mine = computed(() => sw.swaps.value.filter((s) => s.self === self.value))
const fmt = (t: TokenAmount) => `${formatAmount(BigInt(t.amount), t.decimals)} ${t.symbol}`
const inTime = (t: number) => formatCooldown(t - sw.chainNow.value)

function needsUnlock(): boolean {
  if (wallet.isActiveWalletUnlocked.value) return false
  requestUnlock('/swaps')
  return true
}

async function run(action: () => Promise<unknown>, success: string) {
  if (needsUnlock()) return false
  try {
    await action()
    toast.show(success, 'success')
    void account.loadBalances()
    return true
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Swap action failed', 'error')
    return false
  }
}

// --- Token + amount picker shared by start and join ---
const tokens = computed(() => account.balances.value.filter((b) => BigInt(b.balance) > 0n))
function picked(zts: string, amountText: string): TokenAmount | null {
  const b = account.balances.value.find((x) => x.tokenStandard === zts)
  if (!b) return null
  const amount = parseAmount(amountText, b.decimals)
  if (amount === null || amount === 0n || amount > BigInt(b.balance)) return null
  return { amount: amount.toString(), zts, symbol: b.symbol ?? '?', decimals: b.decimals }
}

// --- Start ---
const startTo = ref('')
const startZts = ref('')
const startAmount = ref('')
const startConfirm = ref(false)
const startToValid = computed(() => {
  try {
    SdkAddress.parse(startTo.value.trim())
    return startTo.value.trim() !== self.value
  } catch {
    return false
  }
})
const startSend = computed(() => picked(startZts.value, startAmount.value))

async function submitStart() {
  if (!self.value || !startSend.value) return
  const send = startSend.value
  const ok = await run(() => sw.startSwap(self.value as string, startTo.value.trim(), send), 'Swap started: share the swap ID')
  if (ok) {
    startConfirm.value = false
    startAmount.value = ''
  }
}

// --- Join ---
const joinId = ref('')
const candidate = ref<JoinCandidate | null>(null)
const joinZts = ref('')
const joinAmount = ref('')
const joinAcknowledged = ref(false)
const inspecting = ref(false)
const joinSend = computed(() => picked(joinZts.value, joinAmount.value))

async function inspectJoin() {
  if (!self.value) return
  inspecting.value = true
  candidate.value = null
  try {
    candidate.value = await sw.inspect(self.value, joinId.value)
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Could not check this swap', 'error')
  } finally {
    inspecting.value = false
  }
}

async function submitJoin() {
  if (!self.value || !candidate.value || !joinSend.value || !joinAcknowledged.value) return
  const c = candidate.value
  const send = joinSend.value
  const ok = await run(() => sw.joinSwap(self.value as string, c, send), 'Joined: waiting for the counterparty')
  if (ok) {
    candidate.value = null
    joinId.value = ''
    joinAmount.value = ''
    joinAcknowledged.value = false
  }
}

// --- Swap list ---
const stateLabel: Record<Swap['state'], string> = {
  pending: 'Publishing',
  active: 'Active',
  completed: 'Completed',
  reclaimable: 'Expired',
  unsuccessful: 'Reclaimed',
}
const confirmTarget = ref<Swap | null>(null)

function describe(s: Swap): string {
  const action = sw.nextAction(s)
  if (s.state === 'pending') return 'Waiting for the network to receive the deposit.'
  if (s.state === 'completed') return 'Done.'
  if (s.state === 'unsuccessful') return 'Your deposit was returned.'
  if (action === 'wait-reclaim') {
    const own = s.direction === 'outgoing' ? s.initialExpiration : s.counterExpiration ?? 0
    return `The swap can't complete any more. Your deposit can be reclaimed in ${inTime(own)}.`
  }
  if (action === 'reclaim') return 'The swap expired. Reclaim your deposit.'
  if (s.direction === 'outgoing') {
    if (!s.counterHtlcId) {
      return `Share the swap ID with the counterparty. They have until ${formatDate(s.initialExpiration - 7 * 3600)} to deposit.`
    }
    return action === 'confirm-counter' || action === 'complete'
      ? `The counterparty deposited ${s.receive ? fmt(s.receive) : ''}. Complete before ${formatDate((s.counterExpiration ?? 0) - 600)}.`
      : 'Waiting.'
  }
  if (s.revealedPreimage) return 'The counterparty completed. Receiving your side automatically…'
  return `Waiting for the counterparty to complete (their deadline: ${formatDate(s.counterExpiration ?? 0)}).`
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button variant="outline" title="Go back" @click="router.push('/')"><ArrowLeftIcon /></Button>
        <Heading as="h1">P2P Swaps</Heading>
      </div>
    </div>

    <div class="container mx-auto max-w-3xl space-y-6 p-4">
      <Alert>
        <AlertDescription>
          Trustless swaps with another Zenon address through the HTLC contract (compatible with Syrius). The
          initiator deposits for {{ INITIAL_HTLC_DURATION / 3600 }} hours, the counterparty answers with a
          {{ COUNTER_HTLC_DURATION / 3600 }}-hour deposit. Unfinished deposits can be reclaimed after they expire.
        </AlertDescription>
      </Alert>

      <!-- My swaps -->
      <Card v-if="mine.length">
        <CardHeader><Heading as="h2" class="text-lg">My swaps</Heading></CardHeader>
        <CardContent class="space-y-3">
          <div v-for="s in mine" :key="s.id" class="space-y-2 rounded-md border p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <Badge variant="outline">{{ s.direction === 'outgoing' ? 'Started' : 'Joined' }}</Badge>
                <Badge variant="outline">{{ stateLabel[s.state] }}</Badge>
              </div>
              <span class="text-sm">
                Send {{ fmt(s.send) }}<template v-if="s.receive"> · Get {{ fmt(s.receive) }}</template>
              </span>
            </div>
            <p class="text-xs text-muted-foreground">
              With <Address :address="s.counterparty" :copy="false" /> · Swap ID
              <span class="font-mono">{{ s.id.slice(0, 10) }}…</span>
              <CopyButton :value="s.id" />
            </p>
            <p class="text-sm">{{ describe(s) }}</p>
            <div class="flex flex-wrap gap-2">
              <Button v-if="sw.nextAction(s) === 'confirm-counter'" size="sm" @click="confirmTarget = s">Review deposit</Button>
              <Button
                v-if="sw.nextAction(s) === 'complete'"
                size="sm"
                :disabled="sw.isBusy.value"
                @click="run(() => sw.completeSwap(s), 'Swap completed')"
              >
                Complete swap
              </Button>
              <Button
                v-if="sw.nextAction(s) === 'reclaim'"
                size="sm"
                variant="outline"
                :disabled="sw.isBusy.value"
                @click="run(() => sw.reclaim(s), 'Deposit reclaimed')"
              >
                Reclaim deposit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Start -->
      <Card>
        <CardHeader><Heading as="h2" class="text-lg">Start a swap</Heading></CardHeader>
        <CardContent>
          <form @submit.prevent="startConfirm = true">
            <FieldGroup>
              <Field>
                <FieldLabel for="swap-to">Counterparty address</FieldLabel>
                <Input id="swap-to" v-model="startTo" class="font-mono" placeholder="z1…" />
              </Field>
              <div class="flex gap-2">
                <Input id="swap-start-amount" v-model="startAmount" inputmode="decimal" placeholder="Amount" class="flex-1" />
                <Select v-model="startZts">
                  <SelectTrigger class="w-32" aria-label="Token to send"><SelectValue placeholder="Token" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="t in tokens" :key="t.tokenStandard" :value="t.tokenStandard">{{ t.symbol }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" :disabled="!startToValid || !startSend || sw.isBusy.value">Review</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <!-- Join -->
      <Card>
        <CardHeader><Heading as="h2" class="text-lg">Join a swap</Heading></CardHeader>
        <CardContent class="space-y-3">
          <div class="flex gap-2">
            <Input id="swap-join-id" v-model="joinId" class="flex-1 font-mono" placeholder="Swap ID from the counterparty" />
            <Button :disabled="!joinId || inspecting" @click="inspectJoin">{{ inspecting ? 'Checking…' : 'Check' }}</Button>
          </div>
          <template v-if="candidate">
            <div class="rounded-md border p-3 text-sm">
              <p>You get <strong>{{ fmt(candidate.receive) }}</strong> <span class="font-mono text-xs">({{ candidate.receive.zts }})</span></p>
              <p>From <Address :address="candidate.htlc.timeLocked" :copy="false" /></p>
              <p>Their deposit expires {{ formatDate(candidate.htlc.expirationTime) }} (in {{ formatCooldown(candidate.htlc.expirationTime - candidate.now) }})</p>
            </div>
            <div class="flex gap-2">
              <Input id="swap-join-amount" v-model="joinAmount" inputmode="decimal" placeholder="Amount you send" class="flex-1" />
              <Select v-model="joinZts">
                <SelectTrigger class="w-32" aria-label="Token to send in return"><SelectValue placeholder="Token" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="t in tokens" :key="t.tokenStandard" :value="t.tokenStandard">{{ t.symbol }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label class="flex items-start gap-2 text-sm">
              <input v-model="joinAcknowledged" type="checkbox" class="mt-1" />
              <span>
                I understand that after the counterparty completes, this wallet must be open and unlocked before
                {{ formatDate(candidate.htlc.expirationTime - 600) }} to receive my side. Otherwise the counterparty can
                reclaim their deposit while keeping mine.
              </span>
            </label>
            <Button :disabled="!joinSend || !joinAcknowledged || sw.isBusy.value" @click="submitJoin">
              Deposit {{ joinSend ? fmt(joinSend) : '' }} and join
            </Button>
          </template>
        </CardContent>
      </Card>
    </div>

    <!-- Start confirmation -->
    <Dialog :open="startConfirm" @update:open="(v) => !v && !sw.isBusy.value && (startConfirm = false)">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>Start swap</DialogTitle>
          <DialogDescription>
            You deposit {{ startSend ? fmt(startSend) : '' }} for <span class="font-mono">{{ startTo }}</span> for
            {{ INITIAL_HTLC_DURATION / 3600 }} hours. Share the swap ID with them; once they deposit, you review it and
            complete. If they don't, you can reclaim after it expires.
          </DialogDescription>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="sw.isBusy.value" @click="startConfirm = false">Cancel</Button>
          <Button :disabled="sw.isBusy.value" @click="submitStart">Deposit and start</Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- Counter deposit review -->
    <Dialog :open="!!confirmTarget" @update:open="(v) => !v && (confirmTarget = null)">
      <DialogContent v-if="confirmTarget?.receive" class="max-w-md">
        <DialogHeader>
          <DialogTitle>Review the counterparty's deposit</DialogTitle>
          <DialogDescription>Check that this is what you agreed on. Completing gives them your deposit.</DialogDescription>
        </DialogHeader>
        <div class="space-y-1 text-sm">
          <p>You get <strong>{{ fmt(confirmTarget.receive) }}</strong></p>
          <p class="font-mono text-xs break-all">Token {{ confirmTarget.receive.zts }}</p>
          <p>You give {{ fmt(confirmTarget.send) }}</p>
          <p>Complete before {{ formatDate((confirmTarget.counterExpiration ?? 0) - 600) }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="confirmTarget = null">Not what we agreed</Button>
          <Button
            @click="sw.confirmCounter(confirmTarget).then(() => (confirmTarget = null))"
          >
            Looks right
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
