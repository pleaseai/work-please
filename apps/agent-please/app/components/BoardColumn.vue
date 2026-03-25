<script setup lang="ts">
defineProps<{
  status: string
  issues: Array<{
    id: string
    identifier: string
    title: string
    state: string
    priority: number | null
    url: string | null
    assignees: string[]
    labels: string[]
  }>
  count: number
}>()
</script>

<template>
  <div class="flex flex-col min-w-72 max-w-80">
    <div class="flex items-center justify-between px-2 py-2 mb-2">
      <span class="text-sm font-semibold">{{ status }}</span>
      <UBadge variant="subtle" color="neutral" size="xs">
        {{ count }}
      </UBadge>
    </div>

    <div class="flex flex-col gap-2 flex-1 overflow-y-auto">
      <IssueCard
        v-for="issue in issues"
        :key="issue.id"
        :issue="issue"
      />

      <div
        v-if="issues.length === 0"
        class="text-xs text-muted text-center py-4"
      >
        No issues
      </div>
    </div>
  </div>
</template>
