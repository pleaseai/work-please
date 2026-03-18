<script setup lang="ts">
import type { RetryEntryPayload } from '@/lib/api'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

defineProps<{
  entries: RetryEntryPayload[]
}>()

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso))
}
</script>

<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Identifier</TableHead>
        <TableHead class="text-right tabular-nums">
          Attempt
        </TableHead>
        <TableHead>Due At</TableHead>
        <TableHead>Error</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableEmpty v-if="entries.length === 0" :colspan="4">
        No retrying issues
      </TableEmpty>
      <TableRow v-for="entry in entries" :key="entry.issue_id">
        <TableCell class="font-medium">
          <RouterLink
            :to="{ name: 'issue', params: { identifier: entry.issue_identifier } }"
            class="hover:underline"
          >
            {{ entry.issue_identifier }}
          </RouterLink>
        </TableCell>
        <TableCell class="text-right tabular-nums">
          {{ entry.attempt }}
        </TableCell>
        <TableCell class="tabular-nums">
          {{ formatTime(entry.due_at) }}
        </TableCell>
        <TableCell class="max-w-64 truncate text-muted-foreground">
          {{ entry.error ?? '\u2014' }}
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
