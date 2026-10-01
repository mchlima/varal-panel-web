<script setup lang="ts">
import { customerLabel } from '~/lib/customer'
import { formatDate } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import type { TabSummary } from '~/lib/operation'

/**
 * Comanda pendurada (spec 06, seção 8): número, cliente, data em que foi pendurada e o saldo a
 * receber. Tocar abre a tela de receber pela id, porque a comanda pode ser de outro turno.
 */
defineProps<{ tab: TabSummary; pending?: string }>()
</script>

<template>
  <NuxtLink
    :to="`/balcao/comandas/${tab.number}/receber?comanda=${tab.id}`"
    class="flex min-h-20 items-center gap-3 rounded-card border-2 border-border bg-surface py-2 pr-3 pl-2 hover:border-border-strong"
    data-testid="credit-tab-card"
    :data-tab-number="tab.number"
  >
    <span
      class="flex min-w-14 justify-center font-display text-2xl font-extrabold text-text tabular-nums"
      aria-hidden="true"
      >{{ tab.number }}</span
    >
    <span class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="line-clamp-2 text-lg font-bold break-words">
        <span class="sr-only">Comanda {{ tab.number }} · </span
        >{{ tab.customer ? customerLabel(tab.customer) : tab.customerName }}
      </span>
      <span class="flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
        <span v-if="tab.creditAt">Pendurada em {{ formatDate(tab.creditAt) }}</span>
        <span v-if="tab.customer && tab.customerName !== tab.customer.name"
          >· comanda "{{ tab.customerName }}"</span
        >
        <StageChip v-if="pending" status="pending" :label="pending" />
      </span>
    </span>
    <span class="flex flex-col items-end">
      <span
        class="font-display text-lg font-semibold whitespace-nowrap tabular-nums"
        data-testid="credit-tab-balance"
        >{{ formatCents(tab.balanceCents) }}</span
      >
      <span v-if="tab.paidCents > 0" class="text-sm whitespace-nowrap text-text-muted tabular-nums"
        >de {{ formatCents(tab.totalCents) }}</span
      >
    </span>
  </NuxtLink>
</template>
