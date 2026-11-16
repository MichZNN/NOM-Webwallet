<script setup lang="ts">
import {computed, onMounted, onUnmounted, watch} from 'vue'
import {formatDate, formatRelativeTime, HISTORY_PAGE_SIZE, onTxProgress, useHistory, useNetwork} from '@/core'
import {explorerTxUrl} from '@/core/networks'
import {
  Address,
  Alert,
  AlertDescription,
  Amount,
  Button,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Skeleton,
  TxDirection,
  TxStatus,
} from 'nom-ui'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {ExternalLinkIcon} from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    activeAccountAddress: string | null
    isActive?: boolean
  }>(),
  { isActive: false }
)

const history = useHistory(() => props.activeAccountAddress)
const network = useNetwork()
const txUrl = (hash: string) => explorerTxUrl(network.chainId.value, hash)

const pageCount = computed(() => Math.max(1, Math.ceil(history.total.value / HISTORY_PAGE_SIZE)))
const hasPrev = computed(() => history.page.value > 0)
const hasNext = computed(() => history.page.value + 1 < pageCount.value)

function title(entry: { action: string | null; direction: 'in' | 'out' }): string {
  return entry.action ?? (entry.direction === 'in' ? 'Received' : 'Sent')
}

onMounted(() => {
  if (props.isActive) void history.load(0)
})

watch(
  () => props.isActive,
  (active) => {
    if (active) void history.load()
  }
)

watch(
  () => props.activeAccountAddress,
  () => {
    if (props.isActive) void history.load(0)
  }
)

// New activity on this account shows up without a manual refresh (first page only,
// so paging back through older entries isn't yanked away).
const stopProgress = onTxProgress((tx) => {
  if (props.isActive && history.page.value === 0 && tx.address === props.activeAccountAddress) {
    void history.load(0)
  }
})
onUnmounted(stopProgress)
</script>

<template>
  <div class="space-y-3">
    <Alert v-if="history.error.value" variant="destructive">
      <AlertDescription class="flex items-center justify-between gap-2">
        <span>{{ history.error.value }}</span>
        <Button size="sm" variant="outline" :disabled="history.isLoading.value" @click="history.load()">
          Retry
        </Button>
      </AlertDescription>
    </Alert>

    <div v-if="history.isLoading.value && history.entries.value.length === 0" class="space-y-3">
      <Skeleton v-for="i in 3" :key="i" class="h-20 w-full" />
    </div>

    <div
      v-else-if="history.entries.value.length === 0 && !history.error.value"
      class="py-8 text-center text-muted-foreground"
    >
      <p>No transactions yet</p>
    </div>

    <template v-else>
      <Item
        v-for="entry in history.entries.value"
        :key="entry.hash"
        variant="muted"
        class="border-border"
        :class="{ 'opacity-60': history.isLoading.value }"
      >
        <ItemContent class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <TxDirection :direction="entry.direction" />
              <ItemTitle class="truncate">{{ title(entry) }}</ItemTitle>
            </div>
            <Amount
              v-if="entry.symbol && entry.amount !== '0'"
              :value="addNumberDecimals(entry.amount, entry.decimals)"
              :decimals="entry.decimals"
              :symbol="entry.symbol"
              class="font-mono text-sm font-semibold"
            />
          </div>
          <ItemDescription class="line-clamp-none">
            <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
              <span v-if="entry.counterparty" class="flex min-w-0 items-center gap-1">
                {{ entry.direction === 'in' ? 'From' : 'To' }}
                <Address :address="entry.counterparty" :copy="false" />
              </span>
              <span class="flex items-center gap-2">
                <TxStatus v-if="entry.timestamp === null" status="pending" label="Unconfirmed" />
                <span v-else :title="formatDate(entry.timestamp)">
                  {{ formatRelativeTime(entry.timestamp) }}
                </span>
                <a
                  v-if="txUrl(entry.hash)"
                  :href="txUrl(entry.hash) ?? undefined"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="View in explorer"
                >
                  <ExternalLinkIcon class="h-3.5 w-3.5" />
                </a>
              </span>
            </div>
          </ItemDescription>
        </ItemContent>
      </Item>

      <div v-if="pageCount > 1" class="flex items-center justify-between pt-2">
        <Button
          size="sm"
          variant="outline"
          :disabled="!hasPrev || history.isLoading.value"
          @click="history.load(history.page.value - 1)"
        >
          Newer
        </Button>
        <span class="text-xs text-muted-foreground">
          Page {{ history.page.value + 1 }} of {{ pageCount }}
        </span>
        <Button
          size="sm"
          variant="outline"
          :disabled="!hasNext || history.isLoading.value"
          @click="history.load(history.page.value + 1)"
        >
          Older
        </Button>
      </div>
    </template>
  </div>
</template>
