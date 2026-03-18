import type { SessionMessage } from '@/lib/api'
import { useIntervalFn } from '@vueuse/core'
import { onScopeDispose, ref } from 'vue'
import { fetchSessionMessages } from '@/lib/api'
import { toMessage } from '@/lib/utils'

export function useSessionMessages(sessionId: () => string, intervalMs = 5000) {
  const messages = ref<SessionMessage[]>([])
  const error = ref<string | null>(null)
  const loading = ref(true)

  let fetchId = 0
  let fetching = false
  let currentSessionId = sessionId()

  async function load() {
    const id = sessionId()
    if (!id) {
      loading.value = false
      return
    }
    // If sessionId changed, reset fetching guard so we don't skip this load
    if (id !== currentSessionId) {
      currentSessionId = id
      fetching = false
      messages.value = []
      loading.value = true
    }
    if (fetching)
      return
    fetching = true
    const thisId = ++fetchId
    try {
      const result = await fetchSessionMessages(id)
      if (thisId !== fetchId)
        return
      messages.value = result
      error.value = null
    }
    catch (e) {
      if (thisId !== fetchId)
        return
      console.error('[dashboard]', e)
      error.value = toMessage(e)
    }
    finally {
      fetching = false
      if (thisId === fetchId)
        loading.value = false
    }
  }

  load()
  const { pause } = useIntervalFn(load, intervalMs)
  onScopeDispose(pause)

  return { messages, error, loading, refresh: load }
}
