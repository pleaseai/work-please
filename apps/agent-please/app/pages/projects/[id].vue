<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })

const route = useRoute()
const projectId = computed(() => Number(route.params.id))

useHead({ title: () => `Project ${projectId.value} — Agent Please` })

const { columns, project, loading, error } = useProjectBoard(projectId)

const totalIssues = computed(() =>
  columns.value.reduce((sum, col) => sum + col.count, 0),
)
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
              to="/projects"
            />
            <span class="text-lg font-bold">
              {{ project?.platform }}{{ project?.project_number ? ` #${project.project_number}` : '' }}
            </span>
            <UBadge v-if="project" variant="subtle" color="neutral">
              {{ totalIssues }} issues
            </UBadge>
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-6">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="error"
          icon="i-lucide-alert-circle"
        />

        <div v-if="loading" class="flex gap-4 overflow-x-auto">
          <USkeleton v-for="i in 4" :key="i" class="h-96 min-w-72 rounded-xl" />
        </div>

        <div v-else class="flex gap-4 overflow-x-auto pb-4">
          <BoardColumn
            v-for="column in columns"
            :key="column.status"
            :status="column.status"
            :issues="column.issues"
            :count="column.count"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
