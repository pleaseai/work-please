<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { authClient } from '~/lib/auth-client'

const items = computed<NavigationMenuItem[]>(() => [{
  label: 'Dashboard',
  icon: 'i-lucide-layout-dashboard',
  to: '/',
}])

const { data: session } = authClient.useSession(useFetch)

async function signOut() {
  try {
    await authClient.signOut()
  }
  catch (err) {
    console.warn('Sign-out failed:', err)
  }
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 px-2 py-1">
          <span v-if="!collapsed" class="font-bold text-sm">Agent Please</span>
          <span v-else class="font-bold text-sm">AP</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="items"
          orientation="vertical"
          :ui="{ link: collapsed ? 'justify-center' : undefined }"
        />
      </template>

      <template #footer="{ collapsed }">
        <div v-if="session" class="flex items-center gap-2 px-2 py-2">
          <UAvatar
            :alt="session.user?.name || session.user?.email || '?'"
            size="sm"
          />
          <div v-if="!collapsed" class="flex min-w-0 flex-1 items-center justify-between">
            <span class="truncate text-sm">{{ session.user?.name || session.user?.email }}</span>
            <UButton
              icon="i-lucide-log-out"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="signOut"
            />
          </div>
        </div>
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
