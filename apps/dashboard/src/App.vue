<script setup lang="ts">
import ThemeToggle from '@/components/ThemeToggle.vue'
</script>

<template>
  <div class="min-h-screen">
    <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-background focus:text-foreground">
      Skip to main content
    </a>
    <header class="flex items-center justify-end p-4 max-w-6xl mx-auto">
      <ThemeToggle />
    </header>
    <main id="main-content" class="px-6 pb-6 max-w-6xl mx-auto">
      <RouterView />
    </main>
  </div>
</template>
