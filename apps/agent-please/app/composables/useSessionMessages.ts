import { useQuery } from '@tanstack/vue-query'

export function useSessionMessages(sessionId: Ref<string> | (() => string)) {
  const { $orpc } = useNuxtApp()
  const id = computed(() => typeof sessionId === 'function' ? sessionId() : sessionId.value)

  const { data: messages, error: queryError, isPending, refetch } = useQuery(
    computed(() => $orpc.sessions.messages.queryOptions({
      input: { sessionId: id.value },
      refetchInterval: 5000,
    })),
  )

  const error = computed(() => queryError.value?.message ?? null)
  const loading = computed(() => isPending.value && !(messages.value && messages.value.length > 0))

  return { messages: messages as Ref<typeof messages.value>, error, loading, refresh: refetch }
}
