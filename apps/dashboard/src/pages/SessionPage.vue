<script setup lang="ts">
import type { SessionMessageBlock } from '@/lib/api'
import { watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSessionMessages } from '@/composables/useSessionMessages'

const route = useRoute()
const sessionId = () => route.params.id as string
const { messages, loading, error, refresh } = useSessionMessages(sessionId)

// Trigger a fresh load immediately when the session ID changes
watch(() => route.params.id, () => {
  refresh()
})

watchEffect(() => {
  const id = route.params.id as string
  document.title = `Session ${id.slice(0, 8)} \u2014 Work Please`
})

function blockText(block: SessionMessageBlock): string {
  if (block.kind === 'text')
    return block.text ?? ''
  return block.input ?? ''
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" as-child>
        <RouterLink to="/">
          &larr; Dashboard
        </RouterLink>
      </Button>
      <h1 class="text-2xl font-bold">
        Session
      </h1>
      <Badge variant="outline" class="font-mono text-xs">
        {{ (route.params.id as string).slice(0, 8) }}…
      </Badge>
    </div>

    <div v-if="error" class="rounded-md bg-destructive/15 p-4 text-destructive text-sm" role="alert">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-4">
      <Skeleton class="h-20 w-full rounded-xl" />
      <Skeleton class="h-20 w-full rounded-xl" />
      <Skeleton class="h-20 w-full rounded-xl" />
    </div>

    <template v-else-if="messages.length === 0">
      <Card>
        <CardContent class="py-8 text-center text-muted-foreground">
          No messages found.
        </CardContent>
      </Card>
    </template>

    <template v-else>
      <Card v-for="msg in messages" :key="msg.uuid" :class="msg.type === 'assistant' ? 'border-primary/30' : 'border-muted'">
        <CardHeader class="py-3">
          <CardTitle class="text-sm flex items-center gap-2">
            <Badge :variant="msg.type === 'assistant' ? 'default' : 'secondary'" class="text-xs">
              {{ msg.type }}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-2 pt-0">
          <template v-for="(block, i) in msg.content" :key="i">
            <pre v-if="block.kind === 'text'" class="whitespace-pre-wrap text-sm leading-relaxed">{{ blockText(block) }}</pre>
            <details v-else class="rounded-md border bg-muted/50 text-sm">
              <summary class="cursor-pointer px-3 py-2 font-mono text-xs text-primary hover:bg-muted">
                {{ block.tool_name }}
              </summary>
              <pre class="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto">{{ blockText(block) }}</pre>
            </details>
          </template>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
