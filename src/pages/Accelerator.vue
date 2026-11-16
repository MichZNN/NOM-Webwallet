<script setup lang="ts">
import {computed, inject, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import {QSR_ZTS, ZNN_ZTS} from 'znn-typescript-sdk'
import type {Phase, Project} from 'znn-typescript-sdk'
import {formatDate, useAccelerator, useAccount, useWallet} from '@/core'
import type {ProjectMetadata} from '@/core/accelerator-service'
import {
  PROJECT_CREATION_FEE,
  ProjectStatus,
  Vote,
  canAddPhase,
  canUpdatePhase,
  displayStatus,
  fundsSummary,
  phaseFundsError,
  votingEndsAt,
} from '@/core/accelerator-rules'
import {formatCooldown} from '@/core/node-rules'
import {formatAmount, parseAmount} from '@/core/token-rules'
import type {Wallet} from '@/types'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
} from 'nom-ui'
import {ArrowLeftIcon, ExternalLinkIcon} from 'lucide-vue-next'
import AcceleratorVotes from '@/components/AcceleratorVotes.vue'
import ProjectMetadataDialog from '@/components/ProjectMetadataDialog.vue'

const router = useRouter()
const toast = useToast()
const requestUnlock = inject<(path?: string) => void>('requestUnlock', () => router.push('/'))

const wallet = useWallet()
const address = computed(() => wallet.activeAccountAddress.value)
const account = useAccount(() => address.value)
const acc = useAccelerator(() => address.value)

const now = ref(Math.floor(Date.now() / 1000))
const filter = ref<'all' | 'voting' | 'active' | 'mine'>('all')
const expanded = ref<string | null>(null)

function load() {
  now.value = Math.floor(Date.now() / 1000)
  void acc.load()
  void account.loadBalances()
}
onMounted(load)
watch(address, load)
watch(acc.votingPillar, () => void acc.loadVotes().catch(() => undefined))

const fmt = (amount: bigint) => formatAmount(amount, 8)
const status = (item: Project | Phase, isProject: boolean) =>
  displayStatus({ statusInt: item.statusInt, creationTimestamp: item.creationTimestamp }, isProject, now.value)
const statusLabel: Record<string, string> = {
  voting: 'Voting',
  'voting-ended': 'Voting ended',
  active: 'Active',
  paid: 'Paid',
  closed: 'Closed',
  completed: 'Completed',
}
const isMine = (p: Project) => p.owner.toString() === address.value

const visible = computed(() =>
  acc.projects.value.filter((p) => {
    if (filter.value === 'mine') return isMine(p)
    if (filter.value === 'voting')
      return p.statusInt === ProjectStatus.Voting || p.phases.some((ph) => ph.statusInt === ProjectStatus.Voting)
    if (filter.value === 'active') return p.statusInt === ProjectStatus.Active
    return true
  })
)


const canVoteOn = (item: Project | Phase, isProject: boolean) =>
  acc.ownedPillars.value.length > 0 && status(item, isProject) === 'voting'

async function act(action: (w: Wallet) => Promise<void>, success: string): Promise<boolean> {
  const active = wallet.activeWallet.value
  if (!wallet.isActiveWalletUnlocked.value || !active) {
    requestUnlock('/accelerator')
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

function vote(item: Project | Phase, choice: Vote) {
  const pillar = acc.votingPillar.value
  if (!pillar) return
  const word = choice === Vote.Yes ? 'Yes' : choice === Vote.No ? 'No' : 'Abstain'
  void act((w) => acc.vote(w, item.id.toString(), pillar, choice, `Vote ${word} on ${item.name}`), `Voted ${word} on ${item.name}`)
}

// --- Create / add phase / update phase ---
type Editor =
  | { kind: 'create' }
  | { kind: 'add-phase'; project: Project }
  | { kind: 'update-phase'; project: Project; phase: Phase }
const editor = ref<Editor | null>(null)

const editorProps = computed(() => {
  const e = editor.value
  if (!e) return null
  if (e.kind === 'create') {
    return {
      title: 'Create Project',
      description: `Costs ${fmt(PROJECT_CREATION_FEE)} ZNN (not refunded). The project is accepted as soon as enough pillars vote yes; if that doesn't happen within 14 days it is closed. Once accepted you add phases to get paid.`,
      submitLabel: `Create for ${fmt(PROJECT_CREATION_FEE)} ZNN`,
    }
  }
  const project = e.project
  const others = e.kind === 'update-phase' ? project.phases.slice(0, -1) : project.phases
  const summary = fundsSummary({ ...project, phases: others.map((p) => ({ ...p, status: p.statusInt })) })
  return {
    title: e.kind === 'add-phase' ? `Add phase to ${project.name}` : `Update phase ${e.phase.name}`,
    description:
      e.kind === 'add-phase'
        ? 'Pillars vote on the phase; once accepted its funds are paid to you.'
        : 'Replaces the phase and resets its votes; pillars have to vote again.',
    submitLabel: e.kind === 'add-phase' ? 'Add Phase' : 'Update Phase',
    remaining: { znn: summary.unallocatedZnn, qsr: summary.unallocatedQsr },
    fundsError: (znn: bigint, qsr: bigint) =>
      phaseFundsError(project, others, { znnFundsNeeded: znn, qsrFundsNeeded: qsr }),
    initial:
      e.kind === 'update-phase'
        ? { name: e.phase.name, description: e.phase.description, url: e.phase.url, znn: e.phase.znnFundsNeeded, qsr: e.phase.qsrFundsNeeded }
        : undefined,
  }
})

const znnBalance = computed(() => {
  const b = account.balances.value.find((x) => x.tokenStandard === ZNN_ZTS.toString())
  return b ? BigInt(b.balance.toString()) : 0n
})

async function submitEditor(m: ProjectMetadata) {
  const e = editor.value
  if (!e) return
  let ok = false
  if (e.kind === 'create') {
    if (znnBalance.value < PROJECT_CREATION_FEE) {
      toast.show('This account needs 1 ZNN for the project fee', 'error')
      return
    }
    ok = await act((w) => acc.createProject(w, m), `Project ${m.name} created`)
  } else if (e.kind === 'add-phase') {
    ok = await act((w) => acc.addPhase(w, e.project.id.toString(), m), `Phase ${m.name} added`)
  } else {
    // UpdatePhase is addressed by the project id; the phase gets a new id.
    ok = await act((w) => acc.updatePhase(w, e.project.id.toString(), m), `Phase ${m.name} updated`)
  }
  if (ok) editor.value = null
}

// --- Donate ---
const showDonate = ref(false)
const donateToken = ref<'ZNN' | 'QSR'>('ZNN')
const donateAmount = ref('')
const donateParsed = computed(() => parseAmount(donateAmount.value, 8))

async function submitDonate() {
  const amount = donateParsed.value
  if (amount === null || amount === 0n) return
  const zts = donateToken.value === 'ZNN' ? ZNN_ZTS.toString() : QSR_ZTS.toString()
  if (await act((w) => acc.donate(w, amount, zts, donateToken.value), `Donated ${donateAmount.value} ${donateToken.value}`)) {
    showDonate.value = false
    donateAmount.value = ''
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button variant="outline" title="Go back" @click="router.push('/')">
          <ArrowLeftIcon />
        </Button>
        <Heading as="h1">Accelerator-Z</Heading>
      </div>
    </div>

    <div class="container mx-auto max-w-3xl space-y-4 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-sm text-muted-foreground">
          Fund: {{ fmt(acc.balances.value.znn) }} ZNN · {{ fmt(acc.balances.value.qsr) }} QSR ·
          {{ acc.activePillars.value }} pillars vote
        </p>
        <div class="flex gap-2">
          <Button variant="outline" :disabled="acc.isBusy.value" @click="showDonate = true">Donate</Button>
          <Button :disabled="acc.isBusy.value" @click="editor = { kind: 'create' }">Create Project</Button>
        </div>
      </div>

      <div v-if="acc.ownedPillars.value.length" class="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
        <span>Voting as pillar</span>
        <Select v-if="acc.ownedPillars.value.length > 1" v-model="acc.votingPillar.value">
          <SelectTrigger class="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in acc.ownedPillars.value" :key="p.name" :value="p.name">{{ p.name }}</SelectItem>
          </SelectContent>
        </Select>
        <strong v-else>{{ acc.votingPillar.value }}</strong>
      </div>

      <p v-else-if="!acc.isLoading.value" class="rounded-md border p-3 text-sm text-muted-foreground">
        Voting is done by pillars. To vote, select the account that is the <strong>owner address</strong> of your
        pillar (the address that registered it); this account owns no pillar.
      </p>

      <div class="flex flex-wrap gap-2" role="group" aria-label="Filter projects">
        <Button
          v-for="f in (['all', 'voting', 'active', 'mine'] as const)"
          :key="f"
          size="sm"
          :variant="filter === f ? 'default' : 'outline'"
          :aria-pressed="filter === f"
          @click="filter = f"
        >
          {{ f === 'all' ? 'All' : f === 'voting' ? 'Open votes' : f === 'active' ? 'Active' : 'Mine' }}
        </Button>
      </div>

      <Alert v-if="acc.error.value" variant="destructive">
        <AlertDescription class="flex items-center justify-between gap-2">
          <span>{{ acc.error.value }}</span>
          <Button size="sm" variant="outline" @click="load()">Retry</Button>
        </AlertDescription>
      </Alert>

      <Skeleton v-if="acc.isLoading.value && !acc.projects.value.length" class="h-32 w-full" />
      <p v-else-if="!visible.length && !acc.error.value" class="py-8 text-center text-muted-foreground">
        No projects here.
      </p>

      <Card v-for="p in visible" :key="p.id.toString()">
        <CardHeader class="cursor-pointer space-y-1" @click="expanded = expanded === p.id.toString() ? null : p.id.toString()">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <Heading as="h2" class="truncate text-base">{{ p.name }}</Heading>
              <Badge variant="outline">{{ statusLabel[status(p, true)] }}</Badge>
              <Badge v-if="isMine(p)" variant="outline">Yours</Badge>
            </div>
            <span class="text-sm">{{ fmt(p.znnFundsNeeded) }} ZNN · {{ fmt(p.qsrFundsNeeded) }} QSR</span>
          </div>
          <p class="text-sm text-muted-foreground">{{ p.description }}</p>
        </CardHeader>

        <CardContent v-if="expanded === p.id.toString()" class="space-y-4">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Owner <Address :address="p.owner.toString()" :copy="false" /></span>
            <span>Created {{ formatDate(p.creationTimestamp) }}</span>
            <a :href="/^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 underline">
              Proposal <ExternalLinkIcon class="h-3 w-3" />
            </a>
          </div>

          <div v-if="p.statusInt === ProjectStatus.Voting" class="space-y-1">
            <p class="text-xs text-muted-foreground">
              <template v-if="status(p, true) === 'voting'">
                Voting ends in {{ formatCooldown(votingEndsAt(p.creationTimestamp) - now) }}
              </template>
              <template v-else>The 14-day voting period is over without acceptance; the project will be closed.</template>
            </p>
            <AcceleratorVotes
              :breakdown="p.voteBreakdown"
              :active-pillars="acc.activePillars.value"
              :my-vote="acc.votes.value.get(p.id.toString())"
              :can-vote="canVoteOn(p, true)"
              :ended="status(p, true) === 'voting-ended'"
              :busy="acc.isBusy.value"
              @vote="(v) => vote(p, v)"
            />
          </div>

          <div v-if="p.statusInt !== ProjectStatus.Voting && p.statusInt !== ProjectStatus.Closed" class="text-sm">
            Paid {{ fmt(fundsSummary({ ...p, phases: p.phases.map((ph) => ({ ...ph, status: ph.statusInt })) }).paidZnn) }} /
            {{ fmt(p.znnFundsNeeded) }} ZNN ·
            {{ fmt(fundsSummary({ ...p, phases: p.phases.map((ph) => ({ ...ph, status: ph.statusInt })) }).paidQsr) }} /
            {{ fmt(p.qsrFundsNeeded) }} QSR
          </div>

          <div v-for="(ph, i) in p.phases" :key="ph.id.toString()" class="space-y-2 rounded-md border p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="font-medium">Phase {{ i + 1 }}: {{ ph.name }}</span>
                <Badge variant="outline">{{ statusLabel[status(ph, false)] }}</Badge>
              </div>
              <span class="text-sm">{{ fmt(ph.znnFundsNeeded) }} ZNN · {{ fmt(ph.qsrFundsNeeded) }} QSR</span>
            </div>
            <p class="text-sm text-muted-foreground">{{ ph.description }}</p>
            <AcceleratorVotes
              v-if="ph.statusInt === ProjectStatus.Voting"
              :breakdown="ph.voteBreakdown"
              :active-pillars="acc.activePillars.value"
              :my-vote="acc.votes.value.get(ph.id.toString())"
              :can-vote="canVoteOn(ph, false)"
              :busy="acc.isBusy.value"
              @vote="(v) => vote(ph, v)"
            />
            <p
              v-if="ph.statusInt === ProjectStatus.Voting && (ph.znnFundsNeeded > acc.balances.value.znn || ph.qsrFundsNeeded > acc.balances.value.qsr)"
              class="text-xs text-warning"
            >
              The fund currently holds less than this phase asks; it can't be paid until it has enough.
            </p>
          </div>

          <div v-if="isMine(p)" class="flex flex-wrap gap-2">
            <Button v-if="canAddPhase({ statusInt: p.statusInt, phases: p.phases.map((ph) => ({ ...ph, status: ph.statusInt })) })" size="sm" :disabled="acc.isBusy.value" @click="editor = { kind: 'add-phase', project: p }">
              Add Phase
            </Button>
            <Button
              v-if="canUpdatePhase({ phases: p.phases.map((ph) => ({ ...ph, status: ph.statusInt })) })"
              size="sm"
              variant="outline"
              :disabled="acc.isBusy.value"
              @click="editor = { kind: 'update-phase', project: p, phase: p.phases[p.phases.length - 1] }"
            >
              Update Phase
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>

    <ProjectMetadataDialog
      v-if="editor && editorProps"
      v-bind="editorProps"
      :busy="acc.isBusy.value"
      @submit="submitEditor"
      @close="editor = null"
    />

    <Dialog :open="showDonate" @update:open="(v) => !v && !acc.isBusy.value && (showDonate = false)">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Donate to Accelerator-Z</DialogTitle>
          <DialogDescription>Donations go to the fund that pays accepted project phases.</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="submitDonate">
          <div class="flex gap-2">
            <Input id="donate-amount" v-model="donateAmount" inputmode="decimal" placeholder="Amount" class="flex-1" />
            <Select v-model="donateToken">
              <SelectTrigger class="w-24" aria-label="Token"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ZNN">ZNN</SelectItem>
                <SelectItem value="QSR">QSR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p v-if="donateAmount && (donateParsed === null || donateParsed === 0n)" class="text-sm text-destructive">
            An amount above 0 with at most 8 decimals
          </p>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="acc.isBusy.value" @click="showDonate = false">Cancel</Button>
            <Button type="submit" :disabled="acc.isBusy.value || donateParsed === null || donateParsed === 0n">Donate</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>
