import type { IssueDetailResponse } from '@/lib/api'
import { useIntervalFn } from '@vueuse/core'
import { ref, watch } from 'vue'
import { fetchIssueDetail } from '@/lib/api'

export function useIssueDetail(identifier: () => string, intervalMs = 3000) {
  const detail = ref<IssueDetailResponse | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)

  async function load() {
    const id = identifier()
    if (!id)
      return
    try {
      detail.value = await fetchIssueDetail(id)
      error.value = null
    }
    catch (e) {
      error.value = (e as Error).message
    }
    finally {
      loading.value = false
    }
  }

  watch(identifier, () => {
    loading.value = true
    detail.value = null
    load()
  })

  load()
  useIntervalFn(load, intervalMs)

  return { detail, error, loading, refresh: load }
}
