<script setup lang="ts">
import type { RunningEntryPayload } from '~/utils/types'
import { formatTime, formatTokens } from '~/utils/format'

defineProps<{
  entries: RunningEntryPayload[]
}>()

const columns = [
  { accessorKey: 'issue_identifier', header: 'Identifier' },
  { accessorKey: 'state', header: 'State' },
  { accessorKey: 'turn_count', header: 'Turn' },
  { accessorKey: 'session_id', header: 'Session' },
  { accessorKey: 'started_at', header: 'Started' },
  { accessorKey: 'last_event', header: 'Last Event' },
  { accessorKey: 'tokens', header: 'Tokens' },
]
</script>

<template>
  <UTable :data="entries" :columns="columns">
    <template #issue_identifier-cell="{ row }">
      <NuxtLink :to="`/issues/${encodeURIComponent(row.original.issue_identifier)}`" class="font-medium hover:underline">
        {{ row.original.issue_identifier }}
      </NuxtLink>
    </template>
    <template #state-cell="{ row }">
      <StateBadge :state="row.original.state" />
    </template>
    <template #turn_count-cell="{ row }">
      <span class="tabular-nums">{{ row.original.turn_count }}</span>
    </template>
    <template #session_id-cell="{ row }">
      <NuxtLink
        v-if="row.original.session_id"
        :to="`/sessions/${encodeURIComponent(row.original.session_id)}`"
        class="max-w-32 truncate text-primary text-xs font-mono hover:underline"
      >
        {{ row.original.session_id }}
      </NuxtLink>
      <span v-else class="text-muted">—</span>
    </template>
    <template #started_at-cell="{ row }">
      <span class="tabular-nums">{{ formatTime(row.original.started_at) }}</span>
    </template>
    <template #last_event-cell="{ row }">
      <span class="text-muted">{{ row.original.last_event ?? '—' }}</span>
    </template>
    <template #tokens-cell="{ row }">
      <span class="tabular-nums">{{ formatTokens(row.original.tokens.total_tokens) }}</span>
    </template>
  </UTable>
</template>
