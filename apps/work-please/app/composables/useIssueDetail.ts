import type { IssueDetailResponse } from '~/utils/types'

export function useIssueDetail(identifier: Ref<string> | (() => string), intervalMs = 3000) {
  const id = computed(() => typeof identifier === 'function' ? identifier() : identifier.value)

  const { data: detail, error: fetchError, status, refresh } = useFetch<IssueDetailResponse>(
    () => `/api/v1/${encodeURIComponent(id.value)}`,
    { lazy: true, watch: [id] },
  )

  const error = computed(() => fetchError.value?.message ?? null)
  const loading = computed(() => status.value === 'pending')

  const { pause } = useIntervalFn(refresh, intervalMs)
  onScopeDispose(pause)

  return { detail, error, loading, refresh }
}
