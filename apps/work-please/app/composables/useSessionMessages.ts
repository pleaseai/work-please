import type { SessionMessage } from '~/utils/types'

export function useSessionMessages(sessionId: Ref<string> | (() => string), intervalMs = 5000) {
  const id = computed(() => typeof sessionId === 'function' ? sessionId() : sessionId.value)

  const { data: messages, error: fetchError, status, refresh } = useFetch<SessionMessage[]>(
    () => `/api/v1/sessions/${encodeURIComponent(id.value)}/messages`,
    { watch: [id], default: () => [] },
  )

  const error = computed(() => fetchError.value?.message ?? null)
  const loading = computed(() => status.value === 'pending' && messages.value.length === 0)

  const { pause } = useIntervalFn(refresh, intervalMs)
  onScopeDispose(pause)

  return { messages, error, loading, refresh }
}
