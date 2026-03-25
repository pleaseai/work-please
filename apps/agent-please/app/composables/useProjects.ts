import { useQuery } from '@tanstack/vue-query'

export function useProjects() {
  const { $orpc } = useNuxtApp()

  const { data, error: queryError, isPending, refetch } = useQuery(
    $orpc.projects.list.queryOptions({
      refetchInterval: 30000,
    }),
  )

  const projects = computed(() => data.value?.projects ?? [])
  const error = computed(() => queryError.value?.message ?? null)
  const loading = computed(() => isPending.value && !data.value)

  return { projects, error, loading, refresh: refetch }
}
