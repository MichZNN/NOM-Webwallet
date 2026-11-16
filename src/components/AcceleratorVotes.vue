<script setup lang="ts">
import {computed} from 'vue'
import {Vote, voteOutcome} from '@/core/accelerator-rules'
import {Button} from 'nom-ui'

const props = defineProps<{
  breakdown: { yes: number; no: number; total: number }
  activePillars: number
  /** The selected pillar's current vote, if any. */
  myVote?: number
  /** Show vote buttons (account owns a pillar and voting is open). */
  canVote: boolean
  /** The voting period is over: show the tally but no outcome. */
  ended?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ vote: [vote: Vote] }>()

const outcome = computed(() => voteOutcome(props.breakdown, props.activePillars))
const abstain = computed(() => props.breakdown.total - props.breakdown.yes - props.breakdown.no)
const pct = (n: number) => (props.activePillars > 0 ? (n / props.activePillars) * 100 : 0)

const options = [
  { vote: Vote.Yes, label: 'Yes' },
  { vote: Vote.No, label: 'No' },
  { vote: Vote.Abstain, label: 'Abstain' },
] as const
</script>

<template>
  <div class="space-y-2">
    <div
      class="relative flex h-2 overflow-hidden rounded-full bg-muted"
      role="img"
      :aria-label="`${breakdown.yes} yes, ${breakdown.no} no, ${abstain} abstain of ${activePillars} pillars`"
    >
      <div class="bg-success" :style="{ width: `${pct(breakdown.yes)}%` }" />
      <div class="bg-destructive" :style="{ width: `${pct(breakdown.no)}%` }" />
      <div class="bg-muted-foreground/40" :style="{ width: `${pct(abstain)}%` }" />
      <!-- quorum marker -->
      <div class="absolute inset-y-0 w-px bg-foreground" style="left: 33%" />
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        {{ breakdown.yes }} yes · {{ breakdown.no }} no · {{ abstain }} abstain ·
        {{ breakdown.total }}/{{ outcome.votesNeeded }} votes needed
      </span>
      <span v-if="ended">Voting closed</span>
      <span v-else :class="outcome.passing ? 'text-success' : ''">
        {{ outcome.passing ? 'Passing' : !outcome.quorum ? 'Below quorum' : 'No majority' }}
      </span>
    </div>
    <div v-if="canVote" class="flex flex-wrap items-center gap-2">
      <Button
        v-for="o in options"
        :key="o.vote"
        size="sm"
        :variant="myVote === o.vote ? 'default' : 'outline'"
        :aria-pressed="myVote === o.vote"
        :disabled="busy || myVote === o.vote"
        @click="emit('vote', o.vote)"
      >
        {{ o.label }}
      </Button>
      <span v-if="myVote !== undefined" class="text-xs text-muted-foreground">You can change your vote</span>
    </div>
  </div>
</template>
