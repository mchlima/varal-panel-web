<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { formatCents } from '~/lib/money'
import {
  EVENT_STATUS_LABELS,
  MODALITY_LABELS,
  TAB_STATUS_LABELS,
  priceListName,
} from '~/lib/operation'
import {
  FORBIDDEN_MESSAGE,
  agreementDifferenceLabel,
  eventDates,
  formatDay,
  isForbidden,
  plural,
  receivedDetail,
  type EventReport,
} from '~/lib/report'

/**
 * Relatório do evento (`/painel/relatorios/eventos/{id}`, spec 07, seção 6): as comandas ligadas
 * ao evento, de qualquer dia (RN-07.10), e a comparação entre o combinado e o consumido
 * (CA-07.03). Em andamento, valores parciais (RN-07.06). Só do dono (RN-07.07).
 */
const route = useRoute()
const { $api } = useNuxtApp()
const id = computed(() => String(route.params.id))

const report = ref<EventReport | null>(null)
const loadError = ref('')
const notFound = ref(false)
const forbidden = ref(false)
const loading = ref(false)

useHead({
  title: () =>
    report.value
      ? `${report.value.event.contractorName} · Relatórios · Varal`
      : 'Relatório do evento · Varal',
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const { data, error, response } = await $api.GET('/api/v1/events/{id}/report', {
      params: { path: { id: id.value } },
    })
    forbidden.value = isForbidden(error)
    notFound.value = !data && response.status === 404
    if (data) report.value = data
    else if (!forbidden.value && !notFound.value) loadError.value = apiErrorMessage(error)
  } catch (cause) {
    loadError.value = apiErrorMessage(cause)
  } finally {
    loading.value = false
  }
}
watch(
  id,
  () => {
    report.value = null
    void load()
  },
  { immediate: true },
)
useRealtimeResync(() => load())

let timer: ReturnType<typeof setTimeout> | null = null
function reloadSoon(unitId: string) {
  if (!report.value?.partial || unitId !== report.value.event.unitId) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), 1000)
}
onScopeDispose(() => {
  if (timer) clearTimeout(timer)
})
useRealtimeEvent('tab.updated', (event) => reloadSoon(event.unitId))
useRealtimeEvent('event.updated', (event) => reloadSoon(event.unitId))

const backTo = computed(() => {
  const back = import.meta.client ? (window.history.state?.back as unknown) : null
  return typeof back === 'string' &&
    (back.startsWith('/painel/relatorios') || back.startsWith('/painel/eventos'))
    ? back
    : '/painel/relatorios?aba=eventos'
})

const event = computed(() => report.value?.event ?? null)
</script>

<template>
  <PanelShell>
    <NuxtLink
      :to="backTo"
      class="flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Voltar
    </NuxtLink>

    <AppAlert v-if="forbidden" tone="error" data-testid="report-forbidden">
      {{ FORBIDDEN_MESSAGE }}
    </AppAlert>
    <AppAlert v-else-if="notFound" tone="error">Evento não encontrado.</AppAlert>
    <AppAlert v-else-if="loadError" tone="error">
      <p>{{ loadError }}</p>
      <button type="button" class="min-h-12 font-bold underline" @click="load">
        Tentar de novo
      </button>
    </AppAlert>
    <p v-else-if="!report" class="text-text-muted">Carregando relatório…</p>

    <template v-if="report && event">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl">{{ event.contractorName }}</h1>
        <p class="flex flex-wrap items-center gap-2 text-text-muted">
          {{ eventDates(event) }} · {{ report.unitName }}
          <StageChip
            :status="event.status === 'in_progress' ? 'preparing' : 'delivered'"
            :label="EVENT_STATUS_LABELS[event.status]"
          />
        </p>
      </div>

      <ReportPartialBanner v-if="report.partial" :loading="loading" @refresh="load" />

      <!-- Resumo -->
      <section
        class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
        aria-labelledby="summary-title"
        data-testid="report-summary"
      >
        <h2 id="summary-title" class="font-display text-lg font-bold">Resumo</h2>
        <p class="flex items-center gap-1.5 text-sm">
          <AppIcon name="tag" :size="16" />
          Preços: {{ priceListName(event.priceList) }}
        </p>
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ReportStat
            label="Venda"
            :value="formatCents(report.summary.salesCents)"
            :detail="plural(report.summary.tabCount, 'comanda', 'comandas')"
            strong
          />
          <ReportStat
            label="Recebido"
            :value="formatCents(report.summary.receivedCents)"
            :detail="receivedDetail(report.summary, formatCents)"
          />
          <ReportStat label="Pendurado" :value="formatCents(report.summary.onCreditCents)" />
        </dl>
      </section>

      <!-- Acordo -->
      <ReportSection
        title="Acordo"
        :aside="agreementDifferenceLabel(report.agreement.quantityDifference)"
        open
        data-testid="report-agreement"
      >
        <p class="font-bold">{{ MODALITY_LABELS[event.modality] }}</p>
        <dl class="grid grid-cols-2 gap-2">
          <ReportStat
            label="Quantidade combinada"
            :value="event.agreedQuantity === null ? '—' : String(event.agreedQuantity)"
          />
          <ReportStat label="Consumida" :value="String(report.agreement.consumedQuantity)" />
          <ReportStat
            label="Valor combinado"
            :value="event.agreedAmountCents === null ? '—' : formatCents(event.agreedAmountCents)"
          />
          <ReportStat label="Consumo" :value="formatCents(report.agreement.consumedCents)" />
        </dl>
        <p
          v-if="report.agreement.quantityDifference !== null"
          class="font-bold"
          data-testid="agreement-difference"
        >
          Diferença: {{ report.agreement.quantityDifference }} ({{
            agreementDifferenceLabel(report.agreement.quantityDifference).toLowerCase()
          }})
        </p>
        <p v-if="event.limits" class="text-sm">Limites: {{ event.limits }}</p>
        <p v-if="event.notes" class="text-sm">Observação: {{ event.notes }}</p>
      </ReportSection>

      <ReportProducts :products="report.products" />

      <!-- Comandas -->
      <ReportSection
        title="Comandas"
        :aside="plural(report.tabs.length, 'comanda', 'comandas')"
        data-testid="report-tabs"
      >
        <p v-if="report.tabs.length === 0" class="text-sm text-text-muted">
          Nenhuma comanda ligada a este evento.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="tab in report.tabs"
            :key="tab.tabId"
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
          >
            <span class="min-w-0 flex-1">
              <span class="font-bold">{{ tab.number }} · {{ tab.customerName }}</span>
              <span class="block text-sm text-text-muted">
                {{ formatDay(tab.businessDate) }} · {{ TAB_STATUS_LABELS[tab.status] }} · pago
                {{ formatCents(tab.paidCents) }}
                <template v-if="tab.balanceCents > 0">
                  · a receber {{ formatCents(tab.balanceCents) }}</template
                >
              </span>
            </span>
            <span class="font-bold tabular-nums">{{ formatCents(tab.totalCents) }}</span>
          </li>
        </ul>
      </ReportSection>

      <ReportCredit :credit="report.credit" />
      <ReportCancellations :cancellations="report.cancellations" />
    </template>
  </PanelShell>
</template>
