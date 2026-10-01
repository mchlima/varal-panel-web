<script setup lang="ts">
import type { IconName } from './AppIcon.vue'

/** Aviso com ícone e texto (status nunca só por cor, spec 08). */
const props = withDefaults(defineProps<{ tone?: 'error' | 'info' | 'success' }>(), {
  tone: 'info',
})

const icon = computed<IconName>(
  () =>
    (
      ({ error: 'alert-circle', info: 'info', success: 'check-circle' }) as const satisfies Record<
        string,
        IconName
      >
    )[props.tone],
)
</script>

<template>
  <div
    :role="tone === 'error' ? 'alert' : 'status'"
    class="flex items-start gap-3 rounded-card border-2 p-4 text-base"
    :class="{
      'border-error bg-surface text-error': tone === 'error',
      'border-border bg-surface text-text': tone === 'info',
      'border-status-ready-text bg-status-ready-bg text-status-ready-text': tone === 'success',
    }"
  >
    <AppIcon :name="icon" class="mt-0.5" />
    <div class="min-w-0 flex-1"><slot /></div>
  </div>
</template>
