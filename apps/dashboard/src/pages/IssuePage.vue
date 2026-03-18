<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import StateBadge from '@/components/StateBadge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useIssueDetail } from '@/composables/useIssueDetail'
import { formatDateTime, formatTokens } from '@/lib/format'

const route = useRoute()
const identifier = () => route.params.identifier as string
const { detail, loading, error } = useIssueDetail(identifier)

watchEffect(() => {
  document.title = `${route.params.identifier} \u2014 Work Please`
})

const tokens = computed(() => {
  if (!detail.value?.running)
    return null
  return detail.value.running.tokens
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" as-child>
        <RouterLink to="/">
          &larr; Back
        </RouterLink>
      </Button>
      <h1 class="text-2xl font-bold">
        {{ route.params.identifier }}
      </h1>
      <Badge v-if="detail" :variant="detail.status === 'running' ? 'default' : 'outline'">
        {{ detail.status }}
      </Badge>
    </div>

    <div v-if="error" class="rounded-md bg-destructive/15 p-4 text-destructive text-sm" role="alert">
      {{ error }}
    </div>

    <div v-if="loading" class="space-y-4">
      <Skeleton class="h-32 w-full rounded-xl" />
      <Skeleton class="h-48 w-full rounded-xl" />
    </div>

    <template v-else-if="detail">
      <!-- Running info -->
      <Card v-if="detail.running">
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="text-muted-foreground">State</span>
              <div><StateBadge :state="detail.running.state" /></div>
            </div>
            <div>
              <span class="text-muted-foreground">Turns</span>
              <div class="tabular-nums font-medium">
                {{ detail.running.turn_count }}
              </div>
            </div>
            <div>
              <span class="text-muted-foreground">Started</span>
              <div class="tabular-nums">
                {{ formatDateTime(detail.running.started_at) }}
              </div>
            </div>
            <div>
              <span class="text-muted-foreground">Last Event</span>
              <div>{{ detail.running.last_event ?? '\u2014' }}</div>
            </div>
          </div>

          <Separator />

          <div v-if="tokens" class="flex gap-6">
            <div>
              <span class="text-muted-foreground">Input</span>
              <div class="tabular-nums">
                {{ formatTokens(tokens.input_tokens) }}
              </div>
            </div>
            <div>
              <span class="text-muted-foreground">Output</span>
              <div class="tabular-nums">
                {{ formatTokens(tokens.output_tokens) }}
              </div>
            </div>
            <div>
              <span class="text-muted-foreground">Total</span>
              <div class="tabular-nums font-medium">
                {{ formatTokens(tokens.total_tokens) }}
              </div>
            </div>
          </div>

          <div v-if="detail.running.session_id">
            <span class="text-muted-foreground">Session ID</span>
            <div class="font-mono text-xs break-all">
              <RouterLink
                :to="{ name: 'session', params: { id: detail.running.session_id } }"
                class="text-primary hover:underline"
              >
                {{ detail.running.session_id }}
              </RouterLink>
            </div>
          </div>

          <div v-if="detail.running.last_message">
            <span class="text-muted-foreground">Last Message</span>
            <div class="text-xs whitespace-pre-wrap">
              {{ detail.running.last_message }}
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Retry info -->
      <Card v-if="detail.retry">
        <CardHeader>
          <CardTitle>Retry</CardTitle>
        </CardHeader>
        <CardContent class="space-y-2 text-sm">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="text-muted-foreground">Attempt</span>
              <div class="tabular-nums font-medium">
                {{ detail.retry.attempt }}
              </div>
            </div>
            <div>
              <span class="text-muted-foreground">Due At</span>
              <div class="tabular-nums">
                {{ formatDateTime(detail.retry.due_at) }}
              </div>
            </div>
          </div>
          <div v-if="detail.retry.error">
            <span class="text-muted-foreground">Error</span>
            <div class="text-destructive text-xs whitespace-pre-wrap">
              {{ detail.retry.error }}
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Recent events -->
      <Card v-if="detail.recent_events.length > 0">
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div v-for="(event, i) in detail.recent_events" :key="i" class="flex gap-3 text-sm py-1">
            <span class="tabular-nums text-muted-foreground shrink-0">
              {{ formatDateTime(event.at) }}
            </span>
            <Badge variant="outline" class="shrink-0">
              {{ event.event }}
            </Badge>
            <span v-if="event.message" class="truncate text-muted-foreground" :title="event.message">
              {{ event.message }}
            </span>
          </div>
        </CardContent>
      </Card>

      <!-- Workspace -->
      <div class="text-xs text-muted-foreground">
        Workspace: <code class="font-mono">{{ detail.workspace.path }}</code>
      </div>
    </template>
  </div>
</template>
