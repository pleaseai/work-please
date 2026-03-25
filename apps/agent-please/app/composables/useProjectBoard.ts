import { useQuery } from '@tanstack/vue-query'

export function useProjectBoard(id: Ref<number> | (() => number)) {
  const { $orpc } = useNuxtApp()
  const projectId = computed(() => typeof id === 'function' ? id() : id.value)

  const { data: board, error: queryError, isPending, refetch } = useQuery(
    computed(() => $orpc.projects.live.experimental_liveOptions({
      input: { id: projectId.value },
      retry: true,
    })),
  )

  const columns = computed(() => board.value?.columns ?? [])
  const project = computed(() => board.value?.project ?? null)
  const error = computed(() => queryError.value?.message ?? null)
  const loading = computed(() => isPending.value && !board.value)

  return { board, columns, project, error, loading, refresh: refetch }
}
