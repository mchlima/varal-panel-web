<script setup lang="ts">
import { formatDateTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { actorName, plural, type ReportCanceledItem, type ReportCanceledTab } from '~/lib/report'

/**
 * "Cancelamentos e perdas" (spec 07, seções 4 e 6): itens cancelados com motivo, quem cancelou
 * e se foi perda (RN-04.27, RN-07.04), e as comandas canceladas.
 */
const props = defineProps<{
  cancellations: {
    items: readonly ReportCanceledItem[]
    tabs: readonly ReportCanceledTab[]
    wasteCents: number
    wasteQuantity: number
  }
}>()
const count = computed(() => props.cancellations.items.length + props.cancellations.tabs.length)
</script>

<template>
  <ReportSection
    title="Cancelamentos e perdas"
    :aside="plural(count, 'cancelamento', 'cancelamentos')"
    data-testid="report-cancellations"
  >
    <p class="text-sm">
      Perdas: <strong>{{ formatCents(cancellations.wasteCents) }}</strong> ({{
        plural(cancellations.wasteQuantity, 'unidade', 'unidades')
      }})
    </p>
    <h3 class="font-bold">Itens cancelados</h3>
    <p v-if="cancellations.items.length === 0" class="text-sm text-text-muted">
      Nenhum item cancelado.
    </p>
    <ul class="flex flex-col divide-y divide-border">
      <li v-for="item in cancellations.items" :key="item.itemId" class="flex flex-col gap-1 py-2">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="min-w-0 flex-1 font-bold">{{ item.quantity }}× {{ item.productName }}</span>
          <StageChip v-if="item.wasted" status="late" label="Perda" />
          <span class="font-bold tabular-nums">{{ formatCents(item.valueCents) }}</span>
        </div>
        <p class="text-sm text-text-muted">
          Comanda {{ item.tabNumber }} · {{ formatDateTime(item.canceledAt) }} por
          {{ actorName(item.canceledBy) }}
          <template v-if="item.reason"> · motivo: {{ item.reason }}</template>
        </p>
      </li>
    </ul>
    <h3 class="font-bold">Comandas canceladas</h3>
    <p v-if="cancellations.tabs.length === 0" class="text-sm text-text-muted">
      Nenhuma comanda cancelada.
    </p>
    <ul class="flex flex-col divide-y divide-border">
      <li v-for="tab in cancellations.tabs" :key="tab.tabId" class="flex flex-col py-2">
        <span class="font-bold">Comanda {{ tab.number }} · {{ tab.customerName }}</span>
        <span class="text-sm text-text-muted">
          <template v-if="tab.canceledAt">{{ formatDateTime(tab.canceledAt) }} </template>
          <template v-if="tab.canceledBy">por {{ actorName(tab.canceledBy) }}</template>
        </span>
      </li>
    </ul>
  </ReportSection>
</template>
