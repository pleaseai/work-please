import type { StateResponse } from '@/lib/api'
import { useIntervalFn } from '@vueuse/core'
import { ref } from 'vue'
import { fetchState } from '@/lib/api'

export function useOrchestratorState(intervalMs = 3000) {
  const state = ref<StateResponse | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(true)

  async function load() {
    try {
      state.value = await fetchState()
      error.value = null
    }
    catch (e) {
      error.value = (e as Error).message
    }
    finally {
      loading.value = false
    }
  }

  load()
  useIntervalFn(load, intervalMs)

  return { state, error, loading, refresh: load }
}
