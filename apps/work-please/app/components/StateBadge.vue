<script setup lang="ts">
const props = defineProps<{
  state: string
}>()

const color = computed(() => {
  const s = props.state.toLowerCase()
  if (s.includes('done') || s.includes('complete') || s.includes('merged'))
    return 'success' as const
  if (s.includes('fail') || s.includes('error'))
    return 'error' as const
  if (s.includes('retry') || s.includes('wait'))
    return 'warning' as const
  return 'neutral' as const
})
</script>

<template>
  <UBadge :color="color" variant="subtle" size="sm">
    {{ state }}
  </UBadge>
</template>
