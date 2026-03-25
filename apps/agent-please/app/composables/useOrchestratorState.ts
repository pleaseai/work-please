import { useQuery } from '@tanstack/vue-query'

export function useOrchestratorState() {
  const { $orpc } = useNuxtApp()

  const { data: state, error: queryError, isPending, refetch } = useQuery(
    $orpc.orchestrator.state.queryOptions({
      refetchInterval: 3000,
    }),
  )

  const error = computed(() => queryError.value?.message ?? null)
  const loading = computed(() => isPending.value && !state.value)

  return { state, error, loading, refresh: refetch }
}
