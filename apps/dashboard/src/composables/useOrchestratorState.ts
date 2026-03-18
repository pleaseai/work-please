import type { StateResponse } from '@/lib/api'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose, ref } from 'vue'
import { fetchState } from '@/lib/api'
import { toMessage } from '@/lib/utils'

export function useOrchestratorState(intervalMs = 3000) {
  const state = ref<StateResponse | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)

  let fetching = false
  async function load() {
    if (fetching)
      return
    fetching = true
    try {
      state.value = await fetchState()
      error.value = null
    }
    catch (e) {
      console.error('[dashboard]', e)
      error.value = toMessage(e)
    }
    finally {
      fetching = false
      loading.value = false
    }
  }

  load()
  const { pause } = useIntervalFn(load, intervalMs)
  onScopeDispose(pause)

  return { state, error, loading, refresh: load }
}
