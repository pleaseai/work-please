import { useQuery } from '@tanstack/vue-query'

export function useIssueDetail(identifier: Ref<string> | (() => string)) {
  const { $orpc } = useNuxtApp()
  const id = computed(() => typeof identifier === 'function' ? identifier() : identifier.value)

  const { data: detail, error: queryError, isPending, refetch } = useQuery(
    computed(() => $orpc.issues.detail.queryOptions({
      input: { identifier: id.value },
      refetchInterval: 3000,
    })),
  )

  const error = computed(() => queryError.value?.message ?? null)
  const loading = computed(() => isPending.value && !detail.value)

  return { detail, error, loading, refresh: refetch }
}
