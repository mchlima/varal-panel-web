<script setup lang="ts">
import type { IconName } from './AppIcon.vue'

/**
 * Chip de situação de item (spec 08, seções 4 e 6): cores de status, maiúsculas, ícone de 14 px.
 * Nunca só cor (CA-08.03): sempre texto e ícone. As etapas da unidade usam o status equivalente
 * (primeira = Novo, do meio = Preparando, anterior à final = Pronto, final = Entregue).
 */
export type ChipStatus =
  'new' | 'preparing' | 'ready' | 'delivered' | 'late' | 'canceled' | 'pending' | 'closing'

const props = defineProps<{ status: ChipStatus; label: string }>()

const look = {
  new: { icon: 'dot', class: 'bg-status-new-bg text-status-new-text' },
  preparing: { icon: 'clock', class: 'bg-status-preparing-bg text-status-preparing-text' },
  ready: { icon: 'check-circle', class: 'bg-status-ready-bg text-status-ready-text' },
  delivered: { icon: 'check', class: 'bg-status-canceled-bg text-status-canceled-text' },
  late: { icon: 'alert-circle', class: 'bg-status-late-bg text-status-late-text' },
  canceled: { icon: 'x', class: 'bg-status-canceled-bg text-status-canceled-text line-through' },
  pending: { icon: 'refresh', class: 'bg-surface-muted text-text border border-border-strong' },
  closing: { icon: 'receipt', class: 'bg-primary-soft text-primary-deep' },
} as const satisfies Record<ChipStatus, { icon: IconName; class: string }>

const current = computed(() => look[props.status])
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-xs font-bold tracking-wide whitespace-nowrap uppercase"
    :class="current.class"
    :data-status="status"
  >
    <AppIcon :name="current.icon" :size="14" />
    {{ label }}
  </span>
</template>
