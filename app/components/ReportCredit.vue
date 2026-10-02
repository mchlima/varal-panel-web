<script setup lang="ts">
import { customerLabel } from '~/lib/customer'
import { formatDateTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { TAB_STATUS_LABELS } from '~/lib/operation'
import { PAYMENT_METHOD_LABELS } from '~/lib/payment'
import { actorName, formatDay, type ReportCreditTab, type ReportSettlement } from '~/lib/report'

/**
 * "Fiado" (spec 07, seção 4): comandas penduradas, no valor do momento em que foram penduradas
 * (RN-07.03), com o saldo atual, e as quitações recebidas (RN-07.02), com o dia da comanda
 * quitada (pode ser outro, CA-07.02).
 */
withDefaults(
  defineProps<{
    credit: {
      onCreditCents: number
      settlementsCents: number
      tabs: readonly ReportCreditTab[]
      settlements: readonly ReportSettlement[]
    }
    /** Relatório do evento: não mostra as quitações (spec 07, seção 6). */
    hideSettlements?: boolean
  }>(),
  { hideSettlements: false },
)
</script>

<template>
  <ReportSection
    title="Fiado"
    :aside="formatCents(credit.onCreditCents)"
    data-testid="report-credit"
  >
    <h3 class="font-bold">Pendurado · {{ formatCents(credit.onCreditCents) }}</h3>
    <p v-if="credit.tabs.length === 0" class="text-sm text-text-muted">
      Nenhuma comanda pendurada.
    </p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="tab in credit.tabs"
        :key="tab.tabId"
        class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
      >
        <span class="min-w-0 flex-1">
          <NuxtLink
            v-if="tab.customer && !tab.customer.removed"
            :to="`/painel/fiado/${tab.customer.id}`"
            class="font-bold text-primary-deep underline"
            >{{ customerLabel(tab.customer) }}</NuxtLink
          >
          <span v-else class="font-bold">{{
            tab.customer ? 'Cliente removido' : tab.customerName
          }}</span>
          <span class="block text-sm text-text-muted">
            Comanda {{ tab.number }} · {{ formatDateTime(tab.creditAt) }} ·
            {{ TAB_STATUS_LABELS[tab.status] }}
            <template v-if="tab.status === 'on_credit'">
              · deve {{ formatCents(tab.balanceCents) }}</template
            >
          </span>
        </span>
        <span class="font-bold tabular-nums">{{ formatCents(tab.amountCents) }}</span>
      </li>
    </ul>
    <template v-if="!hideSettlements">
      <h3 class="font-bold">Quitações recebidas · {{ formatCents(credit.settlementsCents) }}</h3>
      <p v-if="credit.settlements.length === 0" class="text-sm text-text-muted">
        Nenhuma quitação recebida.
      </p>
      <ul class="flex flex-col divide-y divide-border">
        <li
          v-for="settlement in credit.settlements"
          :key="settlement.paymentId"
          class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
        >
          <span class="min-w-0 flex-1">
            <span class="font-bold">{{
              settlement.customer
                ? settlement.customer.removed
                  ? 'Cliente removido'
                  : customerLabel(settlement.customer)
                : settlement.customerName
            }}</span>
            <span class="block text-sm text-text-muted">
              Comanda {{ settlement.tabNumber }} (de {{ formatDay(settlement.tabBusinessDate) }}) ·
              {{ PAYMENT_METHOD_LABELS[settlement.method] }} ·
              {{ formatDateTime(settlement.receivedAt) }} por
              {{ actorName(settlement.receivedBy) }}
            </span>
          </span>
          <span class="font-bold tabular-nums">{{ formatCents(settlement.amountCents) }}</span>
        </li>
      </ul>
    </template>
  </ReportSection>
</template>
