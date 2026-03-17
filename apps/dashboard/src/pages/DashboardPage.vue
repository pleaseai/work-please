<script setup lang="ts">
import { computed } from 'vue'
import MetricCard from '@/components/MetricCard.vue'
import RefreshButton from '@/components/RefreshButton.vue'
import RetryTable from '@/components/RetryTable.vue'
import RunningTable from '@/components/RunningTable.vue'
import { Skeleton } from '@/components/ui/skeleton'
import { useOrchestratorState } from '@/composables/useOrchestratorState'

const { state, loading, error, refresh } = useOrchestratorState()

const secondsRunning = computed(() => {
  if (!state.value)
    return '0s'
  const s = Math.round(state.value.codex_totals.seconds_running)
  if (s < 60)
    return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
})

function formatTokens(n: number): string {
  return new Intl.NumberFormat().format(n)
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        Work Please
      </h1>
      <RefreshButton @refreshed="refresh" />
    </div>

    <div v-if="error" class="rounded-md bg-destructive/15 p-4 text-destructive text-sm" role="alert">
      {{ error }}
    </div>

    <!-- Metrics -->
    <div v-if="loading" class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Skeleton v-for="i in 4" :key="i" class="h-24 rounded-xl" />
    </div>
    <div v-else-if="state" class="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricCard title="Running" :value="state.counts.running" />
      <MetricCard title="Retrying" :value="state.counts.retrying" />
      <MetricCard title="Total Tokens" :value="formatTokens(state.codex_totals.total_tokens)" />
      <MetricCard title="Time Running" :value="secondsRunning" />
    </div>

    <!-- Running table -->
    <section>
      <h2 class="text-lg font-semibold mb-3">
        Running
      </h2>
      <div v-if="loading" class="space-y-2">
        <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
      </div>
      <RunningTable v-else-if="state" :entries="state.running" />
    </section>

    <!-- Retry table -->
    <section>
      <h2 class="text-lg font-semibold mb-3">
        Retry Queue
      </h2>
      <div v-if="loading" class="space-y-2">
        <Skeleton v-for="i in 2" :key="i" class="h-10 w-full" />
      </div>
      <RetryTable v-else-if="state" :entries="state.retrying" />
    </section>

    <footer v-if="state" class="text-xs text-muted-foreground pt-4">
      Generated {{ state.generated_at }}
    </footer>
  </div>
</template>
