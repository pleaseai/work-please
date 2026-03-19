<script setup lang="ts">
import { formatDateTime, formatTokens } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })

const route = useRoute()
const identifier = computed(() => route.params.identifier as string)

useHead({ title: () => `${identifier.value} — Work Please` })

const { detail, loading, error } = useIssueDetail(identifier)

const tokens = computed(() => detail.value?.running?.tokens ?? null)
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
            <span class="text-lg font-bold">{{ identifier }}</span>
            <UBadge
              v-if="detail"
              :color="detail.status === 'running' ? 'primary' : 'warning'"
              variant="subtle"
            >
              {{ detail.status }}
            </UBadge>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 p-6">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-alert-circle"
        />

        <div v-if="loading" class="space-y-4">
          <USkeleton class="h-32 w-full rounded-xl" />
          <USkeleton class="h-48 w-full rounded-xl" />
        </div>

        <template v-else-if="detail">
          <!-- Running info -->
          <UCard v-if="detail.running">
            <template #header>
              <span class="font-semibold">Session</span>
            </template>

            <div class="space-y-3 text-sm">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="text-muted">State</span>
                  <div><StateBadge :state="detail.running.state" /></div>
                </div>
                <div>
                  <span class="text-muted">Turns</span>
                  <div class="tabular-nums font-medium">
                    {{ detail.running.turn_count }}
                  </div>
                </div>
                <div>
                  <span class="text-muted">Started</span>
                  <div class="tabular-nums">
                    {{ formatDateTime(detail.running.started_at) }}
                  </div>
                </div>
                <div>
                  <span class="text-muted">Last Event</span>
                  <div>{{ detail.running.last_event ?? '—' }}</div>
                </div>
              </div>

              <USeparator />

              <div v-if="tokens" class="flex gap-6">
                <div>
                  <span class="text-muted">Input</span>
                  <div class="tabular-nums">
                    {{ formatTokens(tokens.input_tokens) }}
                  </div>
                </div>
                <div>
                  <span class="text-muted">Output</span>
                  <div class="tabular-nums">
                    {{ formatTokens(tokens.output_tokens) }}
                  </div>
                </div>
                <div>
                  <span class="text-muted">Total</span>
                  <div class="tabular-nums font-medium">
                    {{ formatTokens(tokens.total_tokens) }}
                  </div>
                </div>
              </div>

              <div v-if="detail.running.session_id">
                <span class="text-muted">Session ID</span>
                <div class="font-mono text-xs break-all">
                  {{ detail.running.session_id }}
                </div>
              </div>

              <div v-if="detail.running.last_message">
                <span class="text-muted">Last Message</span>
                <div class="text-xs whitespace-pre-wrap">
                  {{ detail.running.last_message }}
                </div>
              </div>
            </div>
          </UCard>

          <!-- Retry info -->
          <UCard v-if="detail.retry">
            <template #header>
              <span class="font-semibold">Retry</span>
            </template>

            <div class="space-y-2 text-sm">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="text-muted">Attempt</span>
                  <div class="tabular-nums font-medium">
                    {{ detail.retry.attempt }}
                  </div>
                </div>
                <div>
                  <span class="text-muted">Due At</span>
                  <div class="tabular-nums">
                    {{ formatDateTime(detail.retry.due_at) }}
                  </div>
                </div>
              </div>
              <div v-if="detail.retry.error">
                <span class="text-muted">Error</span>
                <div class="text-error text-xs whitespace-pre-wrap">
                  {{ detail.retry.error }}
                </div>
              </div>
            </div>
          </UCard>

          <!-- Recent events -->
          <UCard v-if="detail.recent_events.length > 0">
            <template #header>
              <span class="font-semibold">Recent Events</span>
            </template>

            <div v-for="(event, i) in detail.recent_events" :key="i" class="flex gap-3 text-sm py-1">
              <span class="tabular-nums text-muted shrink-0">
                {{ formatDateTime(event.at) }}
              </span>
              <UBadge variant="outline" class="shrink-0">
                {{ event.event }}
              </UBadge>
              <span v-if="event.message" class="truncate text-muted" :title="event.message">
                {{ event.message }}
              </span>
            </div>
          </UCard>

          <!-- Workspace -->
          <div class="text-xs text-muted">
            Workspace: <code class="font-mono">{{ detail.workspace.path }}</code>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
