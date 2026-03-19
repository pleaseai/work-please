<script setup lang="ts">
import { formatDateTime, formatSecondsRunning, formatTokens } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Work Please — Dashboard' })

const { state, loading, error, refresh } = useOrchestratorState()
const refreshError = ref<string | null>(null)
const refreshing = ref(false)

const secondsRunning = computed(() => {
  if (!state.value)
    return '0s'
  return formatSecondsRunning(state.value.codex_totals.seconds_running)
})

async function handleRefresh() {
  refreshing.value = true
  refreshError.value = null
  try {
    await $fetch('/api/v1/refresh', { method: 'POST' })
    await refresh()
  }
  catch (e: any) {
    refreshError.value = e?.message ?? 'Refresh failed'
  }
  finally {
    refreshing.value = false
  }
}
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            label="Refresh"
            variant="outline"
            size="sm"
            :loading="refreshing"
            @click="handleRefresh"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6 p-6">
        <UAlert
          v-if="error || refreshError"
          color="error"
          variant="subtle"
          :title="error || refreshError || ''"
          icon="i-lucide-alert-circle"
        />

        <!-- Metrics -->
        <div v-if="loading" class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <USkeleton v-for="i in 4" :key="i" class="h-24 rounded-xl" />
        </div>
        <div v-else-if="state" class="grid grid-cols-2 gap-4 md:grid-cols-4">
          <UCard>
            <div class="text-sm font-medium text-muted">
              Running
            </div>
            <div class="text-2xl font-bold tabular-nums mt-1">
              {{ state.counts.running }}
            </div>
          </UCard>
          <UCard>
            <div class="text-sm font-medium text-muted">
              Retrying
            </div>
            <div class="text-2xl font-bold tabular-nums mt-1">
              {{ state.counts.retrying }}
            </div>
          </UCard>
          <UCard>
            <div class="text-sm font-medium text-muted">
              Total Tokens
            </div>
            <div class="text-2xl font-bold tabular-nums mt-1">
              {{ formatTokens(state.codex_totals.total_tokens) }}
            </div>
          </UCard>
          <UCard>
            <div class="text-sm font-medium text-muted">
              Time Running
            </div>
            <div class="text-2xl font-bold tabular-nums mt-1">
              {{ secondsRunning }}
            </div>
          </UCard>
        </div>

        <!-- Running table -->
        <section>
          <h2 class="text-lg font-semibold mb-3">
            Running
          </h2>
          <div v-if="loading" class="space-y-2">
            <USkeleton v-for="i in 3" :key="i" class="h-10 w-full" />
          </div>
          <div v-else-if="state">
            <RunningTable :entries="state.running" />
          </div>
        </section>

        <!-- Retry table -->
        <section>
          <h2 class="text-lg font-semibold mb-3">
            Retry Queue
          </h2>
          <div v-if="loading" class="space-y-2">
            <USkeleton v-for="i in 2" :key="i" class="h-10 w-full" />
          </div>
          <div v-else-if="state">
            <RetryTable :entries="state.retrying" />
          </div>
        </section>

        <footer v-if="state" class="text-xs text-muted pt-4">
          Generated {{ formatDateTime(state.generated_at) }}
        </footer>
      </div>
    </template>
  </UDashboardPanel>
</template>
