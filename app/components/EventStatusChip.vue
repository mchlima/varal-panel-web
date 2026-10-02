<script setup lang="ts">
import { EVENT_STATUS_LABELS, type ContractedEventStatus } from '~/lib/operation'
import type { IconName } from './AppIcon.vue'

/** Situação do evento (RN-04.34) com texto e ícone, nunca só cor (spec 08, seção 4). */
const props = defineProps<{ status: ContractedEventStatus }>()

const look = {
  in_progress: { icon: 'party', class: 'bg-status-ready-bg text-status-ready-text' },
  scheduled: { icon: 'calendar', class: 'bg-primary-soft text-primary-deep' },
  finished: { icon: 'check', class: 'bg-status-canceled-bg text-status-canceled-text' },
  canceled: { icon: 'x', class: 'bg-status-canceled-bg text-status-canceled-text' },
} as const satisfies Record<ContractedEventStatus, { icon: IconName; class: string }>

const current = computed(() => look[props.status])
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-xs font-bold tracking-wide whitespace-nowrap uppercase"
    :class="current.class"
    :data-status="status"
  >
    <AppIcon :name="current.icon" :size="14" />
    {{ EVENT_STATUS_LABELS[status] }}
  </span>
</template>
