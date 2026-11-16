import {ref, toValue} from 'vue'
import type {MaybeRefOrGetter} from 'vue'
import {AccountService} from '../account-service'
import {decodeContractCall} from '../contract-call'
import {toHistoryEntry} from '../history'
import type {HistoryBlock, HistoryEntry} from '../history'

export const HISTORY_PAGE_SIZE = 10

/** Paged transaction history of one account, newest first. */
export function useHistory(address: MaybeRefOrGetter<string | null>) {
  const entries = ref<HistoryEntry[]>([])
  const page = ref(0)
  const total = ref(0)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  // Drops responses from an earlier load (other page or account) that land late.
  let loadId = 0

  async function load(pageIndex = page.value): Promise<void> {
    const addr = toValue(address)
    if (!addr) {
      entries.value = []
      total.value = 0
      return
    }

    const id = ++loadId
    isLoading.value = true
    error.value = null
    try {
      const list = await AccountService.getInstance().getAccountBlocks(
        addr,
        pageIndex,
        HISTORY_PAGE_SIZE
      )
      if (id !== loadId) return
      page.value = pageIndex
      total.value = list.count ?? 0
      entries.value = (list.list ?? [])
        .map((block) => toHistoryEntry(block as unknown as HistoryBlock, decodeContractCall))
        .filter((entry): entry is HistoryEntry => entry !== null)
    } catch (err) {
      if (id !== loadId) return
      error.value = err instanceof Error ? err.message : 'Failed to load history'
    } finally {
      if (id === loadId) isLoading.value = false
    }
  }

  return { entries, page, total, isLoading, error, load }
}
