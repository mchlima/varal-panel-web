<script setup lang="ts">
import { formatCents } from '~/lib/money'
import { pendingLabel, pendingOperations, tabActionName } from '~/lib/operation-actions'

/**
 * Aba Fiado do balcão (spec 06, seção 8): comandas penduradas da unidade, mais antigas primeiro,
 * com cliente, data e saldo; tocar abre a tela de receber para quitar.
 */
const props = defineProps<{ unitId: string }>()
const connection = useConnectionStore()
const { data, loading, error, load } = useReceivables(toRef(props, 'unitId'))

const pendingByTab = computed(() => {
  const result: Record<string, string> = {}
  for (const op of pendingOperations(
    connection.pending,
    (meta) => meta.kind === 'tab.payment' || meta.kind === 'payment.reverse',
  )) {
    if ('tabId' in op.meta) {
      result[op.meta.tabId] =
        `${tabActionName(op.meta)}: ${pendingLabel(op.action, connection.online)}`
    }
  }
  return result
})
</script>

<template>
  <section class="flex flex-col gap-3" aria-label="Fiado" data-testid="credit-board">
    <AppAlert v-if="error" tone="error">
      <p>{{ error }}</p>
      <button type="button" class="min-h-12 font-bold underline" @click="load">
        Tentar de novo
      </button>
    </AppAlert>
    <p v-if="!data && loading" class="text-text-muted">Carregando fiado…</p>
    <template v-if="data">
      <p class="flex items-baseline justify-between gap-2">
        <span class="text-text-muted">A receber</span>
        <span
          class="font-display text-2xl font-extrabold tabular-nums"
          data-testid="credit-total"
          >{{ formatCents(data.totalCents) }}</span
        >
      </p>
      <p v-if="data.tabs.length === 0" class="text-text-muted">Nenhuma comanda no fiado.</p>
      <ul class="flex flex-col gap-2">
        <li v-for="tab in data.tabs" :key="tab.id">
          <ReceivableTabCard :tab="tab" :pending="pendingByTab[tab.id]" />
        </li>
      </ul>
    </template>
  </section>
</template>
