<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const items = computed<NavigationMenuItem[]>(() => [{
  label: 'Dashboard',
  icon: 'i-lucide-layout-dashboard',
  to: '/',
}])
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 px-2 py-1">
          <span v-if="!collapsed" class="font-bold text-sm">Work Please</span>
          <span v-else class="font-bold text-sm">WP</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="items"
          orientation="vertical"
          :ui="{ link: collapsed ? 'justify-center' : undefined }"
        />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
