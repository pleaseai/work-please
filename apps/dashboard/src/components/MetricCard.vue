<script setup lang="ts">
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

defineProps<{
  title: string
  value: string | number
  description?: string
}>()
</script>

<template>
  <Card>
    <CardHeader class="pb-2">
      <CardTitle class="text-sm font-medium text-muted-foreground">
        {{ title }}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div class="text-2xl font-bold tabular-nums">
        {{ value }}
      </div>
      <p v-if="description" class="text-xs text-muted-foreground mt-1">
        {{ description }}
      </p>
    </CardContent>
  </Card>
</template>
