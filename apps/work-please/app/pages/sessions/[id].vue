<script setup lang="ts">
import type { SessionMessageBlock } from '~/utils/types'

definePageMeta({ layout: 'dashboard' })

const route = useRoute()
const sessionId = computed(() => route.params.id as string)

useHead({ title: () => `Session ${sessionId.value.slice(0, 8)} — Work Please` })

const { messages, loading, error } = useSessionMessages(sessionId)

function blockText(block: SessionMessageBlock): string {
  if (block.kind === 'text')
    return block.text ?? ''
  return block.input ?? ''
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar>
        <template #left>
          <div class="flex items-center gap-3">
            <UButton
              icon="i-lucide-arrow-left"
              variant="ghost"
              size="sm"
              to="/"
            />
            <span class="text-lg font-bold">Session</span>
            <UBadge variant="outline" class="font-mono text-xs">
              {{ sessionId.slice(0, 8) }}…
            </UBadge>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4 p-6">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-alert-circle"
        />

        <div v-if="loading" class="space-y-4">
          <USkeleton v-for="i in 3" :key="i" class="h-20 w-full rounded-xl" />
        </div>

        <template v-else-if="messages.length === 0">
          <UCard>
            <div class="py-8 text-center text-muted">
              No messages found.
            </div>
          </UCard>
        </template>

        <template v-else>
          <UCard
            v-for="msg in messages"
            :key="msg.uuid"
            :ui="{ root: msg.type === 'assistant' ? 'border-primary/30' : '' }"
          >
            <template #header>
              <UBadge
                :color="msg.type === 'assistant' ? 'primary' : 'neutral'"
                variant="subtle"
                class="text-xs"
              >
                {{ msg.type }}
              </UBadge>
            </template>

            <div class="space-y-2">
              <template v-for="(block, i) in msg.content" :key="i">
                <pre
                  v-if="block.kind === 'text'"
                  class="whitespace-pre-wrap text-sm leading-relaxed"
                >{{ blockText(block) }}</pre>
                <details v-else class="rounded-md border bg-muted/50 text-sm">
                  <summary class="cursor-pointer px-3 py-2 font-mono text-xs text-primary hover:bg-muted">
                    {{ block.tool_name }}
                  </summary>
                  <pre class="px-3 py-2 text-xs text-muted whitespace-pre-wrap overflow-x-auto">{{ blockText(block) }}</pre>
                </details>
              </template>
            </div>
          </UCard>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
