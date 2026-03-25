<script setup lang="ts">
import type { BoardIssue } from '~/types/board'

defineProps<{
  issue: BoardIssue
}>()

const priorityColor = computed(() => {
  return (p: number | null) => {
    if (p === null)
      return 'neutral'
    if (p <= 1)
      return 'error'
    if (p <= 2)
      return 'warning'
    return 'neutral'
  }
})
</script>

<template>
  <NuxtLink
    :to="issue.url ? undefined : `/issues/${encodeURIComponent(issue.identifier)}`"
    :href="issue.url ?? undefined"
    :target="issue.url ? '_blank' : undefined"
    class="block"
  >
    <UCard class="hover:bg-elevated/50 transition-colors cursor-pointer">
      <div class="space-y-2">
        <div class="flex items-start justify-between gap-2">
          <span class="text-sm font-medium leading-tight">{{ issue.title }}</span>
          <UBadge
            v-if="issue.priority !== null"
            :color="priorityColor(issue.priority)"
            variant="subtle"
            size="xs"
          >
            P{{ issue.priority }}
          </UBadge>
        </div>

        <div class="flex items-center gap-2 text-xs text-muted">
          <span class="font-mono">{{ issue.identifier }}</span>
        </div>

        <div v-if="issue.labels.length > 0" class="flex flex-wrap gap-1">
          <UBadge
            v-for="label in issue.labels"
            :key="label"
            variant="outline"
            size="xs"
          >
            {{ label }}
          </UBadge>
        </div>

        <div v-if="issue.assignees.length > 0" class="flex items-center gap-1">
          <UAvatar
            v-for="assignee in issue.assignees"
            :key="assignee"
            :alt="assignee"
            size="2xs"
          />
        </div>
      </div>
    </UCard>
  </NuxtLink>
</template>
