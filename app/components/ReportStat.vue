<script setup lang="ts">
/** Número de destaque de um relatório (spec 07): rótulo, valor grande e um detalhe opcional. */
withDefaults(defineProps<{ label: string; value: string; detail?: string; strong?: boolean }>(), {
  detail: undefined,
  strong: false,
})
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-0.5 rounded-card px-3 py-2"
    :class="strong ? 'bg-primary-soft text-primary-deep' : 'bg-surface-muted'"
  >
    <dt class="text-sm" :class="strong ? '' : 'text-text-muted'">{{ label }}</dt>
    <dd class="font-display text-xl leading-tight font-extrabold tabular-nums">{{ value }}</dd>
    <dd v-if="detail" class="text-sm" :class="strong ? '' : 'text-text-muted'">{{ detail }}</dd>
  </div>
</template>
