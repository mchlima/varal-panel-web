<script setup lang="ts">
import { formatCents } from '~/lib/money'
import { itemsLabel, type TabSummary } from '~/lib/operation'

/**
 * Cartão de comanda (spec 08, seção 6): número grande à esquerda, nome e resumo ao centro,
 * total à direita; borda esquerda primária quando selecionado. Sinais de "pronto para
 * entregar" e de atrasados sempre com texto e ícone (spec 04, seção 8.1).
 */
const props = withDefaults(
  defineProps<{ tab: TabSummary; selected?: boolean; pending?: string }>(),
  {
    selected: false,
    pending: undefined,
  },
)

const readyLabel = computed(() =>
  props.tab.readyItemCount === 1 ? '1 pronto' : `${props.tab.readyItemCount} prontos`,
)
const lateLabel = computed(() =>
  props.tab.lateItemCount === 1 ? '1 atrasado' : `${props.tab.lateItemCount} atrasados`,
)
</script>

<template>
  <NuxtLink
    :to="`/balcao/comandas/${tab.number}`"
    :aria-current="selected ? 'page' : undefined"
    class="flex min-h-20 items-center gap-3 rounded-card border-2 bg-surface py-2 pr-3 pl-2"
    :class="selected ? 'border-primary border-l-8' : 'border-border hover:border-border-strong'"
    data-testid="tab-card"
    :data-tab-number="tab.number"
  >
    <span
      class="flex min-w-14 justify-center font-display text-2xl font-extrabold text-text tabular-nums"
      aria-hidden="true"
      >{{ tab.number }}</span
    >
    <span class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="truncate text-lg font-bold">
        <span class="sr-only">Comanda {{ tab.number }} · </span>{{ tab.customerName }}
      </span>
      <span class="flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
        <span>{{ itemsLabel(tab.itemCount) }}</span>
        <StageChip v-if="tab.status === 'closing'" status="closing" label="Fechando" />
        <StageChip v-if="tab.readyItemCount > 0" status="ready" :label="readyLabel" />
        <StageChip v-if="tab.lateItemCount > 0" status="late" :label="lateLabel" />
        <StageChip v-if="pending" status="pending" :label="pending" />
      </span>
    </span>
    <span class="font-display text-lg font-semibold whitespace-nowrap tabular-nums">{{
      formatCents(tab.totalCents)
    }}</span>
  </NuxtLink>
</template>
