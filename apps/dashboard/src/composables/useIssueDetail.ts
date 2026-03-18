import type { IssueDetailResponse } from '@/lib/api'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose, ref, watch } from 'vue'
import { fetchIssueDetail } from '@/lib/api'
import { toMessage } from '@/lib/utils'

export function useIssueDetail(identifier: () => string, intervalMs = 3000) {
  const detail = ref<IssueDetailResponse | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)

  let fetchId = 0
  let fetching = false
  async function load() {
    const id = identifier()
    if (!id) {
      loading.value = false
      return
    }
    if (fetching)
      return
    fetching = true
    const thisId = ++fetchId
    try {
      const result = await fetchIssueDetail(id)
      if (thisId !== fetchId)
        return
      detail.value = result
      error.value = null
    }
    catch (e) {
      if (thisId !== fetchId)
        return
      console.error('[dashboard]', e)
      error.value = toMessage(e)
    }
    finally {
      fetching = false
      if (thisId === fetchId)
        loading.value = false
    }
  }

  watch(identifier, () => {
    fetchId++
    fetching = false
    loading.value = true
    detail.value = null
    load()
  })

  load()
  const { pause } = useIntervalFn(load, intervalMs)
  onScopeDispose(pause)

  return { detail, error, loading, refresh: load }
}
