<script setup lang="ts">
import {computed, inject, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {QSR_ZTS, ZNN_ZTS, addNumberDecimals} from 'znn-typescript-sdk'
import type {PillarInfo} from 'znn-typescript-sdk'
import {formatDate, useAccount, useNodes, useWallet} from '@/core'
import type {PillarSettings} from '@/core'
import type {Wallet} from '@/types'
import {
  PILLAR_ZNN_AMOUNT,
  SENTINEL_QSR_AMOUNT,
  SENTINEL_ZNN_AMOUNT,
  registrationRequirements,
  revokeStatus,
} from '@/core/node-rules'
import {
  Address,
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Heading,
  Input,
  Skeleton,
  useToast,
} from 'nom-ui'
import {ArrowLeftIcon} from 'lucide-vue-next'
import PillarSettingsDialog from '@/components/PillarSettingsDialog.vue'

const router = useRouter()
const toast = useToast()
const requestUnlock = inject<(path?: string) => void>('requestUnlock', () => router.push('/'))

const wallet = useWallet()
const address = computed(() => wallet.activeAccountAddress.value)
const account = useAccount(() => address.value)
const nodes = useNodes(() => address.value)

const isLocked = computed(() => !wallet.isActiveWalletUnlocked.value)

function rawBalance(zts: string): bigint {
  const b = account.balances.value.find((x) => x.tokenStandard === zts)
  return b ? BigInt(b.balance.toString()) : 0n
}
const znn = computed(() => rawBalance(ZNN_ZTS.toString()))
const qsr = computed(() => rawBalance(QSR_ZTS.toString()))
const fmt = (amount: bigint) => addNumberDecimals(amount.toString(), 8)

const pillarCosts = computed(() =>
  registrationRequirements({
    znnRequired: PILLAR_ZNN_AMOUNT,
    qsrRequired: nodes.pillarQsrCost.value,
    qsrDeposited: nodes.pillarDeposit.value,
    znnBalance: znn.value,
    qsrBalance: qsr.value,
  })
)
const sentinelCosts = computed(() =>
  registrationRequirements({
    znnRequired: SENTINEL_ZNN_AMOUNT,
    qsrRequired: SENTINEL_QSR_AMOUNT,
    qsrDeposited: nodes.sentinelDeposit.value,
    znnBalance: znn.value,
    qsrBalance: qsr.value,
  })
)

// Dialog state
const settingsDialog = ref<{ mode: 'register' | 'update'; initial: PillarSettings } | null>(null)
const revokeTarget = ref<{ kind: 'pillar'; name: string } | { kind: 'sentinel' } | null>(null)
const revokeConfirmText = ref('')

function load() {
  void nodes.load()
  void account.loadBalances()
}
onMounted(load)
watch(address, load)

/** Run an action that needs the unlocked wallet; toasts the outcome. */
async function act(action: (w: Wallet) => Promise<void>, success: string): Promise<boolean> {
  const active = wallet.activeWallet.value
  if (isLocked.value || !active) {
    requestUnlock('/nodes')
    return false
  }
  try {
    await action(active)
    toast.show(success, 'success')
    return true
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Transaction failed', 'error')
    return false
  }
}

function openUpdate(p: PillarInfo) {
  settingsDialog.value = {
    mode: 'update',
    initial: {
      name: p.name,
      producer: p.producerAddress.toString(),
      reward: p.withdrawAddress.toString(),
      giveMomentumPercentage: p.giveMomentumRewardPercentage,
      giveDelegatePercentage: p.giveDelegateRewardPercentage,
    },
  }
}

function openRegister() {
  const own = address.value ?? ''
  settingsDialog.value = {
    mode: 'register',
    // Same defaults as Syrius: keep momentum rewards, give all delegation rewards.
    initial: { name: '', producer: '', reward: own, giveMomentumPercentage: 0, giveDelegatePercentage: 100 },
  }
}

async function submitSettings(s: PillarSettings) {
  const ok =
    settingsDialog.value?.mode === 'register'
      ? await act((w) => nodes.registerPillar(w, s), `Pillar ${s.name} registered`)
      : await act((w) => nodes.updatePillar(w, s), `Pillar ${s.name} updated`)
  if (ok) settingsDialog.value = null
}

const revokeConfirmed = computed(() => {
  const t = revokeTarget.value
  if (!t) return false
  return t.kind === 'sentinel' || revokeConfirmText.value.trim() === t.name
})

async function confirmRevoke() {
  const t = revokeTarget.value
  if (!t || !revokeConfirmed.value) return
  const ok =
    t.kind === 'pillar'
      ? await act((w) => nodes.revokePillar(w, t.name), `Pillar ${t.name} revoked`)
      : await act((w) => nodes.revokeSentinel(w), 'Sentinel revoked')
  if (ok) {
    revokeTarget.value = null
    revokeConfirmText.value = ''
  }
}

// go-zenon definition/pillars.go: 1 = legacy, 2 = normal. The SDK's
// PillarInfo.regularPillarType constant is wrong (1), so it isn't used.
function pillarType(p: PillarInfo): string {
  return p.type === 1 ? 'Legacy' : 'Regular'
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button variant="outline" title="Go back" @click="router.push('/')">
          <ArrowLeftIcon />
        </Button>
        <Heading as="h1">Pillar &amp; Sentinel</Heading>
      </div>
    </div>

    <div class="container mx-auto max-w-3xl space-y-6 p-4">
      <p v-if="address" class="text-sm text-muted-foreground">
        Account <Address :address="address" :copy="false" /> ·
        {{ fmt(znn) }} ZNN · {{ fmt(qsr) }} QSR
      </p>

      <Alert v-if="nodes.error.value" variant="destructive">
        <AlertDescription class="flex items-center justify-between gap-2">
          <span>{{ nodes.error.value }}</span>
          <Button size="sm" variant="outline" :disabled="nodes.isLoading.value" @click="load">
            Retry
          </Button>
        </AlertDescription>
      </Alert>

      <!-- Pillar -->
      <Card>
        <CardHeader><Heading as="h2" class="text-lg">Pillar</Heading></CardHeader>
        <CardContent class="space-y-4">
          <Skeleton v-if="nodes.isLoading.value && !nodes.pillars.value.length" class="h-24 w-full" />

          <div
            v-for="p in nodes.pillars.value"
            :key="p.name"
            class="space-y-3 rounded-md border p-4"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-lg font-semibold">{{ p.name }}</span>
                <Badge variant="outline">Rank #{{ p.rank + 1 }}</Badge>
                <Badge variant="outline">{{ pillarType(p) }}</Badge>
              </div>
              <div class="flex gap-2">
                <Button size="sm" :disabled="nodes.isBusy.value" @click="openUpdate(p)">Update</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  :disabled="!p.isRevocable || nodes.isBusy.value"
                  @click="revokeTarget = { kind: 'pillar', name: p.name }"
                >
                  Revoke
                </Button>
              </div>
            </div>
            <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt class="text-muted-foreground">Producer</dt><dd><Address :address="p.producerAddress.toString()" /></dd></div>
              <div><dt class="text-muted-foreground">Reward address</dt><dd><Address :address="p.withdrawAddress.toString()" /></dd></div>
              <div><dt class="text-muted-foreground">Momentum rewards to delegators</dt><dd>{{ p.giveMomentumRewardPercentage }}%</dd></div>
              <div><dt class="text-muted-foreground">Delegation rewards to delegators</dt><dd>{{ p.giveDelegateRewardPercentage }}%</dd></div>
              <div><dt class="text-muted-foreground">Weight</dt><dd>{{ fmt(BigInt(p.weight.toString())) }} ZNN</dd></div>
              <div>
                <dt class="text-muted-foreground">Momentums this epoch</dt>
                <dd>{{ p.currentStats.producedMomentums }} / {{ p.currentStats.expectedMomentums }}</dd>
              </div>
            </dl>
            <p class="text-xs text-muted-foreground">{{ revokeStatus(p.isRevocable, p.revokeCooldown) }}</p>
          </div>

          <template v-if="!nodes.isLoading.value && nodes.pillars.value.length === 0">
            <p class="text-sm text-muted-foreground">
              This account owns no pillar. Registering one locks
              {{ fmt(PILLAR_ZNN_AMOUNT) }} ZNN and burns the deposited
              {{ fmt(nodes.pillarQsrCost.value) }} QSR. You need a running pillar node with its
              own producer address.
            </p>
            <ul class="space-y-1 text-sm">
              <li :class="pillarCosts.znn.met ? '' : 'text-destructive'">
                {{ fmt(pillarCosts.znn.needed) }} ZNN needed, {{ fmt(znn) }} available
              </li>
              <li :class="pillarCosts.qsr.met ? '' : 'text-destructive'">
                {{ fmt(pillarCosts.qsr.needed) }} QSR still to deposit
                (deposited: {{ fmt(nodes.pillarDeposit.value) }}), {{ fmt(qsr) }} available
              </li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <Button :disabled="!pillarCosts.ready || nodes.isBusy.value" @click="openRegister">
                Register Pillar
              </Button>
              <Button
                v-if="nodes.pillarDeposit.value > 0n"
                variant="outline"
                :disabled="nodes.isBusy.value"
                @click="act((w) => nodes.withdrawQsr(w, 'pillar'), 'Deposited QSR withdrawn')"
              >
                Withdraw {{ fmt(nodes.pillarDeposit.value) }} deposited QSR
              </Button>
            </div>
          </template>
        </CardContent>
      </Card>

      <!-- Sentinel -->
      <Card>
        <CardHeader><Heading as="h2" class="text-lg">Sentinel</Heading></CardHeader>
        <CardContent class="space-y-4">
          <Skeleton v-if="nodes.isLoading.value && !nodes.sentinel.value" class="h-16 w-full" />

          <div v-if="nodes.sentinel.value" class="space-y-3 rounded-md border p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="font-semibold">Your sentinel</span>
                <Badge :variant="nodes.sentinel.value.active ? 'success' : 'outline'">
                  {{ nodes.sentinel.value.active ? 'Active' : 'Inactive' }}
                </Badge>
              </div>
              <Button
                size="sm"
                variant="destructive"
                :disabled="!nodes.sentinel.value.isRevocable || nodes.isBusy.value"
                @click="revokeTarget = { kind: 'sentinel' }"
              >
                Revoke
              </Button>
            </div>
            <p class="text-sm">
              Registered {{ formatDate(nodes.sentinel.value.registrationTimestamp) }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ revokeStatus(nodes.sentinel.value.isRevocable, nodes.sentinel.value.revokeCooldown) }}
            </p>
          </div>

          <template v-else-if="!nodes.isLoading.value">
            <p class="text-sm text-muted-foreground">
              This account runs no sentinel. Registering one locks {{ fmt(SENTINEL_ZNN_AMOUNT) }} ZNN
              and {{ fmt(SENTINEL_QSR_AMOUNT) }} QSR.
            </p>
            <ul class="space-y-1 text-sm">
              <li :class="sentinelCosts.znn.met ? '' : 'text-destructive'">
                {{ fmt(sentinelCosts.znn.needed) }} ZNN needed, {{ fmt(znn) }} available
              </li>
              <li :class="sentinelCosts.qsr.met ? '' : 'text-destructive'">
                {{ fmt(sentinelCosts.qsr.needed) }} QSR still to deposit
                (deposited: {{ fmt(nodes.sentinelDeposit.value) }}), {{ fmt(qsr) }} available
              </li>
            </ul>
            <div class="flex flex-wrap gap-2">
              <Button
                :disabled="!sentinelCosts.ready || nodes.isBusy.value"
                @click="act((w) => nodes.registerSentinel(w), 'Sentinel registered')"
              >
                Register Sentinel
              </Button>
              <Button
                v-if="nodes.sentinelDeposit.value > 0n"
                variant="outline"
                :disabled="nodes.isBusy.value"
                @click="act((w) => nodes.withdrawQsr(w, 'sentinel'), 'Deposited QSR withdrawn')"
              >
                Withdraw {{ fmt(nodes.sentinelDeposit.value) }} deposited QSR
              </Button>
            </div>
          </template>
        </CardContent>
      </Card>

      <p class="text-xs text-muted-foreground">
        Rewards are collected in the Rewards tab on the home screen.
      </p>
    </div>

    <PillarSettingsDialog
      v-if="settingsDialog"
      :mode="settingsDialog.mode"
      :initial="settingsDialog.initial"
      :busy="nodes.isBusy.value"
      @submit="submitSettings"
      @close="settingsDialog = null"
    />

    <Dialog
      :open="!!revokeTarget"
      @update:open="(v) => !v && !nodes.isBusy.value && ((revokeTarget = null), (revokeConfirmText = ''))"
    >
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ revokeTarget?.kind === 'pillar' ? `Revoke pillar ${revokeTarget.name}` : 'Revoke sentinel' }}
          </DialogTitle>
          <DialogDescription>
            <template v-if="revokeTarget?.kind === 'pillar'">
              The pillar stops producing momentums and its delegations end. The locked 15,000 ZNN
              return to this account; the burned QSR does not.
            </template>
            <template v-else>
              The sentinel stops earning rewards. The locked ZNN and QSR return to this account.
            </template>
          </DialogDescription>
        </DialogHeader>
        <div v-if="revokeTarget?.kind === 'pillar'" class="space-y-2">
          <label for="revoke-confirm" class="text-sm">Type the pillar name to confirm</label>
          <Input id="revoke-confirm" v-model="revokeConfirmText" :placeholder="revokeTarget.name" />
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="nodes.isBusy.value" @click="revokeTarget = null">Cancel</Button>
          <Button
            variant="destructive"
            :disabled="!revokeConfirmed || nodes.isBusy.value"
            @click="confirmRevoke"
          >
            Revoke
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
