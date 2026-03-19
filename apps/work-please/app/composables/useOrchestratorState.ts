import type { StateResponse } from '~/utils/types'

export function useOrchestratorState(intervalMs = 3000) {
  const { data: state, error: fetchError, status, refresh } = useFetch<StateResponse>('/api/v1/state', {
    lazy: true,
  })

  const error = computed(() => fetchError.value?.message ?? null)
  const loading = computed(() => status.value === 'pending')

  const { pause } = useIntervalFn(refresh, intervalMs)
  onScopeDispose(pause)

  return { state, error, loading, refresh }
}
