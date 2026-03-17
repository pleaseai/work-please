<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { triggerRefresh } from '@/lib/api'

const emit = defineEmits<{
  refreshed: []
}>()

const loading = ref(false)

async function handleRefresh() {
  loading.value = true
  try {
    await triggerRefresh()
    emit('refreshed')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <Button
    variant="outline"
    size="sm"
    :disabled="loading"
    :aria-busy="loading"
    @click="handleRefresh"
  >
    <span v-if="loading" class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
    Refresh
  </Button>
</template>
