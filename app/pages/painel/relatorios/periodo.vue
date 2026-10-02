<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { EVENT_STATUS_LABELS } from '~/lib/operation'
import { PAYMENT_METHOD_LABELS, differenceLabel } from '~/lib/payment'
import {
  FORBIDDEN_MESSAGE,
  actorName,
  filtersToQuery,
  formatDay,
  formatDayWithWeekday,
  formatRange,
  historyQuery,
  isForbidden,
  plural,
  rangeFromQuery,
  receivedDetail,
  todayInSaoPaulo,
  type SummaryReport,
} from '~/lib/report'

/**
 * Relatório do dia ou do período (`/painel/relatorios/periodo?unidade=&de=&ate=`, spec 07,
 * seção 4): resumo no topo e as demais seções recolhíveis, para caber no celular. Sem
 * `unidade`, todas as unidades. Quando inclui o dia atual de uma unidade com caixa aberto, os
 * valores são parciais e a faixa avisa (RN-07.06); a tela recarrega quando algo muda. Todas as
 * datas são dias de operação (RN-04.29). Só do dono (RN-07.07).
 */
const route = useRoute()
const { $api } = useNuxtApp()
const today = todayInSaoPaulo()

const range = computed(() => rangeFromQuery(route.query, today, 'today'))
const unitId = computed(() =>
  typeof route.query.unidade === 'string' && route.query.unidade ? route.query.unidade : null,
)
const query = computed(() => historyQuery({ ...range.value, unitId: unitId.value }))

const report = ref<SummaryReport | null>(null)
const loadError = ref('')
const forbidden = ref(false)
const loading = ref(false)

const isDay = computed(() => range.value.from === range.value.to)
const title = computed(() =>
  isDay.value ? `Dia ${formatDayWithWeekday(range.value.from)}` : formatRange(range.value),
)
useHead({ title: () => `${title.value} · Relatórios · Varal` })

let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/reports/summary', {
      params: { query: query.value },
    })
    if (current !== generation) return
    forbidden.value = isForbidden(error)
    if (data) report.value = data
    else if (!forbidden.value) loadError.value = apiErrorMessage(error)
  } catch (cause) {
    if (current === generation) loadError.value = apiErrorMessage(cause)
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(
  () => JSON.stringify(query.value),
  () => {
    report.value = null
    void load()
  },
  { immediate: true },
)
useRealtimeResync(() => load())

// Parcial (RN-07.06): os valores mudam com a operação; recarrega pouco depois de cada mudança.
let timer: ReturnType<typeof setTimeout> | null = null
function reloadSoon(eventUnitId: string) {
  if (!report.value?.partial) return
  if (unitId.value && eventUnitId !== unitId.value) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), 1000)
}
onScopeDispose(() => {
  if (timer) clearTimeout(timer)
})
useRealtimeEvent('tab.updated', (event) => reloadSoon(event.unitId))
useRealtimeEvent('order_item.canceled', (event) => reloadSoon(event.unitId))
useRealtimeEvent('cash_register.updated', (event) => reloadSoon(event.unitId))
useRealtimeEvent('cash_register.closed', (event) => reloadSoon(event.unitId))

/** Volta ao histórico com o mesmo período e unidade. */
const backTo = computed(() => ({
  path: '/painel/relatorios',
  query: filtersToQuery({ ...range.value, unitId: unitId.value, tab: 'dias' }),
}))

const summary = computed(() => report.value?.summary ?? null)
const paymentTotals = computed(() => {
  const lines = report.value?.paymentMethods ?? []
  return {
    salesCents: lines.reduce((sum, line) => sum + line.salesCents, 0),
    settlementsCents: lines.reduce((sum, line) => sum + line.settlementsCents, 0),
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
  }
})
const sessionsReceived = computed(() =>
  (report.value?.cashSessions ?? []).reduce((sum, line) => sum + line.receivedCents, 0),
)
</script>

<template>
  <PanelShell>
    <NuxtLink
      :to="backTo"
      class="flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Histórico
    </NuxtLink>

    <AppAlert v-if="forbidden" tone="error" data-testid="report-forbidden">
      {{ FORBIDDEN_MESSAGE }}
    </AppAlert>
    <AppAlert v-else-if="loadError" tone="error">
      <p>{{ loadError }}</p>
      <button type="button" class="min-h-12 font-bold underline" @click="load">
        Tentar de novo
      </button>
    </AppAlert>
    <p v-else-if="!report" class="text-text-muted">Carregando relatório…</p>

    <template v-if="report && summary">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl">{{ title }}</h1>
        <p class="text-text-muted">{{ report.unit?.name ?? 'Todas as unidades' }}</p>
      </div>

      <ReportPartialBanner v-if="report.partial" :loading="loading" @refresh="load" />

      <!-- Resumo -->
      <section
        class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
        aria-labelledby="summary-title"
        data-testid="report-summary"
      >
        <h2 id="summary-title" class="font-display text-lg font-bold">Resumo</h2>
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ReportStat
            label="Venda"
            :value="formatCents(summary.salesCents)"
            :detail="plural(summary.tabCount, 'comanda concluída', 'comandas concluídas')"
            strong
          />
          <ReportStat
            label="Recebido"
            :value="formatCents(summary.receivedCents)"
            :detail="receivedDetail(summary, formatCents)"
          />
          <ReportStat label="Pendurado" :value="formatCents(summary.onCreditCents)" />
          <ReportStat label="Ticket médio" :value="formatCents(summary.averageTicketCents)" />
          <ReportStat label="Descontos" :value="formatCents(summary.discountsCents)" />
          <ReportStat
            label="Perdas"
            :value="formatCents(summary.wasteCents)"
            :detail="plural(summary.wasteQuantity, 'unidade', 'unidades')"
          />
          <ReportStat
            label="Diferença de caixa"
            :value="differenceLabel(summary.cashDifferenceCents)"
            :detail="report.partial ? 'só caixas fechados' : undefined"
          />
          <ReportStat label="Comandas canceladas" :value="String(summary.canceledTabCount)" />
          <ReportStat
            v-if="report.openTabsNow"
            label="Em aberto agora"
            :value="formatCents(report.openTabsNow.totalCents)"
            :detail="plural(report.openTabsNow.count, 'comanda', 'comandas')"
          />
        </dl>
        <p class="text-sm text-text-muted">
          Venda: comandas pagas ou penduradas no período. Comandas ainda abertas entram no dia em
          que forem pagas.
        </p>
      </section>

      <ReportProducts :products="report.products" />

      <!-- Por forma de pagamento -->
      <ReportSection
        title="Por forma de pagamento"
        :aside="formatCents(paymentTotals.totalCents)"
        data-testid="report-payments"
      >
        <div class="overflow-x-auto">
          <table class="w-full text-sm tabular-nums">
            <thead>
              <tr class="text-left text-text-muted">
                <th scope="col" class="py-1 pr-2 font-normal">Forma</th>
                <th scope="col" class="py-1 pr-2 text-right font-normal">Vendas</th>
                <th scope="col" class="py-1 pr-2 text-right font-normal">Quitações</th>
                <th scope="col" class="py-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="line in report.paymentMethods"
                :key="line.method"
                class="border-t border-border"
              >
                <th scope="row" class="py-2 pr-2 text-left font-bold">
                  {{ PAYMENT_METHOD_LABELS[line.method] }}
                </th>
                <td class="py-2 pr-2 text-right">{{ formatCents(line.salesCents) }}</td>
                <td class="py-2 pr-2 text-right">{{ formatCents(line.settlementsCents) }}</td>
                <td class="py-2 text-right font-bold">{{ formatCents(line.totalCents) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t-2 border-border-strong">
                <th scope="row" class="py-2 pr-2 text-left font-bold">Total</th>
                <td class="py-2 pr-2 text-right font-bold">
                  {{ formatCents(paymentTotals.salesCents) }}
                </td>
                <td class="py-2 pr-2 text-right font-bold">
                  {{ formatCents(paymentTotals.settlementsCents) }}
                </td>
                <td class="py-2 text-right font-bold">
                  {{ formatCents(paymentTotals.totalCents) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="text-sm text-text-muted">
          Vendas: pagamentos de comandas. Quitações: fiado recebido no período, de comandas de
          qualquer dia.
        </p>
      </ReportSection>

      <!-- Por colaborador -->
      <ReportSection
        title="Por colaborador"
        :aside="plural(report.staff.length, 'pessoa', 'pessoas')"
        data-testid="report-staff"
      >
        <p v-if="report.staff.length === 0" class="text-text-muted">
          Ninguém operou neste período.
        </p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="line in report.staff"
            :key="`${line.actor.type}-${line.actor.id}`"
            class="flex flex-col gap-1 rounded-card bg-surface-muted px-3 py-2"
          >
            <div class="flex items-baseline gap-3">
              <span class="min-w-0 flex-1 font-bold">
                {{ actorName(line.actor) }}
                <span v-if="line.actor.type === 'owner'" class="font-normal text-text-muted"
                  >(dono)</span
                >
              </span>
              <span class="font-bold tabular-nums">{{ formatCents(line.receivedCents) }}</span>
            </div>
            <p class="text-sm text-text-muted">
              {{ plural(line.tabsOpened, 'comanda aberta', 'comandas abertas') }} ·
              {{ plural(line.ordersSent, 'pedido', 'pedidos') }} ·
              {{ plural(line.itemsCanceled, 'item cancelado', 'itens cancelados') }} ·
              {{ plural(line.tabsCanceled, 'comanda cancelada', 'comandas canceladas') }} ·
              {{ plural(line.discountCount, 'desconto', 'descontos') }}
              <template v-if="line.discountCount">
                ({{ formatCents(line.discountsCents) }})</template
              >
            </p>
          </li>
        </ul>
      </ReportSection>

      <!-- Caixas -->
      <ReportSection
        title="Caixas"
        :aside="formatCents(sessionsReceived)"
        data-testid="report-registers"
      >
        <p v-if="report.cashSessions.length === 0" class="text-text-muted">
          Nenhum caixa aberto neste período.
        </p>
        <ul class="flex flex-col gap-2">
          <li v-for="line in report.cashSessions" :key="line.sessionId">
            <NuxtLink
              :to="`/painel/relatorios/caixas/${line.sessionId}`"
              class="flex min-h-14 items-center gap-3 rounded-card bg-surface-muted px-3 py-2 hover:bg-primary-soft"
              data-testid="report-register-row"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="flex flex-wrap items-center gap-2 font-bold">
                  {{ line.name }}
                  <StageChip v-if="line.status === 'open'" status="preparing" label="Aberto" />
                </span>
                <span class="text-sm text-text-muted">
                  {{ formatDay(line.businessDate) }}
                  <template v-if="!report.unit"> · {{ line.unitName }}</template> ·
                  {{ actorName(line.responsible) }} · {{ formatTime(line.openedAt) }}
                  <template v-if="line.closedAt"> às {{ formatTime(line.closedAt) }}</template>
                </span>
                <span class="text-sm">
                  <template v-if="line.status === 'closed'"
                    >Caixa: {{ differenceLabel(line.differenceCents) }}</template
                  >
                  <template v-if="line.pendingTabsCount">
                    ·
                    {{ plural(line.pendingTabsCount, 'comanda pendente', 'comandas pendentes') }}
                    ({{ formatCents(line.pendingTabsTotalCents ?? 0) }})</template
                  >
                </span>
              </span>
              <span class="font-bold tabular-nums">{{ formatCents(line.receivedCents) }}</span>
              <AppIcon name="chevron-right" />
            </NuxtLink>
          </li>
        </ul>
      </ReportSection>

      <ReportCredit :credit="report.credit" />
      <ReportCancellations :cancellations="report.cancellations" />

      <!-- Eventos: só quando houve (spec 07, seção 4) -->
      <ReportSection
        v-if="report.events.length"
        title="Eventos"
        :aside="plural(report.events.length, 'evento', 'eventos')"
        data-testid="report-events"
      >
        <ul class="flex flex-col gap-2">
          <li v-for="event in report.events" :key="event.eventId">
            <NuxtLink
              :to="`/painel/relatorios/eventos/${event.eventId}`"
              class="flex min-h-14 items-center gap-3 rounded-card bg-surface-muted px-3 py-2 hover:bg-primary-soft"
            >
              <span class="flex min-w-0 flex-1 flex-wrap items-center gap-2 font-bold">
                {{ event.contractorName }}
                <StageChip
                  :status="event.status === 'in_progress' ? 'preparing' : 'delivered'"
                  :label="EVENT_STATUS_LABELS[event.status]"
                />
              </span>
              <span class="font-bold tabular-nums">{{ formatCents(event.salesCents) }}</span>
              <AppIcon name="chevron-right" />
            </NuxtLink>
          </li>
        </ul>
      </ReportSection>
    </template>
  </PanelShell>
</template>
