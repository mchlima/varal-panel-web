<script setup lang="ts">
import type { IconName } from './AppIcon.vue'

/**
 * Chip de situação (spec 08, seção 6): cantos de 6 px, maiúsculas, ícone de 14 px.
 * Status nunca só por cor: sempre texto e ícone.
 */
export type ChipTone = 'active' | 'inactive' | 'soldout' | 'info'

const props = defineProps<{ tone: ChipTone; label: string }>()

const look = computed(
  () =>
    ({
      active: { icon: 'check-circle', class: 'bg-status-ready-bg text-status-ready-text' },
      inactive: { icon: 'power', class: 'bg-status-canceled-bg text-status-canceled-text' },
      soldout: { icon: 'ban', class: 'bg-status-late-bg text-status-late-text' },
      info: { icon: 'info', class: 'bg-primary-soft text-primary-deep' },
    }) satisfies Record<ChipTone, { icon: IconName; class: string }>,
)
const current = computed(() => look.value[props.tone])
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-xs font-bold tracking-wide uppercase"
    :class="current.class"
  >
    <AppIcon :name="current.icon" :size="14" />
    {{ label }}
  </span>
</template>
