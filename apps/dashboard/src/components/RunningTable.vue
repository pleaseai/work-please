<script setup lang="ts">
import type { RunningEntryPayload } from '@/lib/api'
import StateBadge from '@/components/StateBadge.vue'
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
  entries: RunningEntryPayload[]
}>()

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso))
}

function formatTokens(n: number): string {
  return new Intl.NumberFormat().format(n)
}
</script>

<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Identifier</TableHead>
        <TableHead>State</TableHead>
        <TableHead class="text-right tabular-nums">
          Turn
        </TableHead>
        <TableHead>Session</TableHead>
        <TableHead>Started</TableHead>
        <TableHead>Last Event</TableHead>
        <TableHead class="text-right tabular-nums">
          Tokens
        </TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableEmpty v-if="entries.length === 0" :colspan="7">
        No running issues
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
        <TableCell>
          <StateBadge :state="entry.state" />
        </TableCell>
        <TableCell class="text-right tabular-nums">
          {{ entry.turn_count }}
        </TableCell>
        <TableCell class="max-w-32 truncate text-muted-foreground text-xs font-mono">
          {{ entry.session_id ?? '\u2014' }}
        </TableCell>
        <TableCell class="tabular-nums">
          {{ formatTime(entry.started_at) }}
        </TableCell>
        <TableCell class="text-muted-foreground">
          {{ entry.last_event ?? '\u2014' }}
        </TableCell>
        <TableCell class="text-right tabular-nums">
          {{ formatTokens(entry.tokens.total_tokens) }}
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
