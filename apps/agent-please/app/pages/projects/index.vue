<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Projects — Agent Please' })

const { projects, loading, error } = useProjects()
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Projects" />
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

        <div v-if="loading" class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <USkeleton v-for="i in 3" :key="i" class="h-32 rounded-xl" />
        </div>

        <div v-else-if="projects.length === 0" class="text-center py-12 text-muted">
          No projects configured. Add a project to your WORKFLOW.md to get started.
        </div>

        <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <NuxtLink
            v-for="project in projects"
            :key="project.index"
            :to="`/projects/${project.index}`"
          >
            <UCard class="hover:bg-elevated/50 transition-colors cursor-pointer h-full">
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-lg font-semibold">
                    {{ project.platform }}{{ project.project_number ? ` #${project.project_number}` : '' }}
                  </span>
                  <UBadge variant="subtle" color="primary">
                    {{ project.platform }}
                  </UBadge>
                </div>

                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="status in project.active_statuses"
                    :key="`active-${status}`"
                    variant="outline"
                    size="xs"
                    color="success"
                  >
                    {{ status }}
                  </UBadge>
                  <UBadge
                    v-for="status in project.watched_statuses"
                    :key="`watched-${status}`"
                    variant="outline"
                    size="xs"
                    color="warning"
                  >
                    {{ status }}
                  </UBadge>
                </div>

                <div class="text-xs text-muted">
                  {{ project.active_statuses.length + project.watched_statuses.length + project.terminal_statuses.length }} statuses configured
                </div>
              </div>
            </UCard>
          </NuxtLink>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
