<script setup lang="ts">
import type { RetryEntryPayload } from '~/utils/types'
import { formatTime } from '~/utils/format'

defineProps<{
  entries: RetryEntryPayload[]
}>()

const columns = [
  { accessorKey: 'issue_identifier', header: 'Identifier' },
  { accessorKey: 'attempt', header: 'Attempt' },
  { accessorKey: 'due_at', header: 'Due At' },
  { accessorKey: 'error', header: 'Error' },
]
</script>

<template>
  <UTable :data="entries" :columns="columns">
    <template #issue_identifier-cell="{ row }">
      <NuxtLink :to="`/issues/${encodeURIComponent(row.original.issue_identifier)}`" class="font-medium hover:underline">
        {{ row.original.issue_identifier }}
      </NuxtLink>
    </template>
    <template #attempt-cell="{ row }">
      <span class="tabular-nums">{{ row.original.attempt }}</span>
    </template>
    <template #due_at-cell="{ row }">
      <span class="tabular-nums">{{ formatTime(row.original.due_at) }}</span>
    </template>
    <template #error-cell="{ row }">
      <span class="max-w-64 truncate text-muted">{{ row.original.error ?? '—' }}</span>
    </template>
  </UTable>
</template>
