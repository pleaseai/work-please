<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  state: string
}>()

const variant = computed(() => {
  const s = props.state.toLowerCase()
  if (s.includes('done') || s.includes('complete') || s.includes('merged'))
    return 'default'
  if (s.includes('fail') || s.includes('error'))
    return 'destructive'
  if (s.includes('retry') || s.includes('wait'))
    return 'outline'
  return 'secondary'
})
</script>

<template>
  <Badge :variant="variant">
    {{ state }}
  </Badge>
</template>
