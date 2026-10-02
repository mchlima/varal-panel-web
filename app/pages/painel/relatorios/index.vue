<script setup lang="ts">
import { formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { EVENT_STATUS_LABELS } from '~/lib/operation'
import { differenceLabel } from '~/lib/payment'
import {
  FORBIDDEN_MESSAGE,
  HISTORY_TABS,
  PERIOD_PRESETS,
  actorName,
  consumptionLabel,
  eventDates,
  filtersFromQuery,
  filtersToQuery,
  formatDay,
  formatDayWithWeekday,
  formatRange,
  historyQuery,
  isForbidden,
  periodReportPath,
  plural,
  presetOf,
  presetRange,
  rangeError,
  receivedDetail,
  todayInSaoPaulo,
  type DayHistoryRow,
  type EventHistoryRow,
  type HistoryFilters,
  type HistoryTab,
  type PeriodPreset,
  type ReportCashSessionLine,
  type ReportTotals,
} from '~/lib/report'

/**
 * Histórico (`/painel/relatorios`, spec 07, seção 7): abas Dias, Caixas e Eventos (esta só para
 * quem tem eventos), filtros de unidade e período (atalhos ou datas), totais do período no topo
 * e a lista mais recente primeiro, com "Carregar mais" por cursor. Os filtros ficam na URL, para
 * voltar de um relatório com eles. "Ver relatório do período" abre o relatório da seção 4. Só do
 * dono (RN-07.07): o colaborador recebe 403 da API (e o middleware nem abre a tela).
 */
useHead({ title: 'Relatórios · Varal' })

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const events = useContractedEventsStore()
const { $api } = useNuxtApp()

const today = todayInSaoPaulo()
const filters = computed(() => filtersFromQuery(route.query, today))
const queryKey = computed(() => JSON.stringify(historyQuery(filters.value)))

function applyFilters(next: Partial<HistoryFilters>) {
  void router.replace({ query: filtersToQuery({ ...filters.value, ...next }) })
}

// Período
const activePreset = computed(() => presetOf(filters.value, today))
const customOpen = ref(false)
const customFrom = ref(filters.value.from)
const customTo = ref(filters.value.to)
const customError = ref('')
function choosePreset(preset: PeriodPreset) {
  customOpen.value = false
  applyFilters(presetRange(preset, today))
}
function openCustom() {
  customFrom.value = filters.value.from
  customTo.value = filters.value.to
  customError.value = ''
  customOpen.value = !customOpen.value
}
function applyCustom() {
  const range = { from: customFrom.value, to: customTo.value }
  customError.value = rangeError(range) ?? ''
  if (customError.value) return
  customOpen.value = false
  applyFilters(range)
}

// Unidade
const units = computed(() => session.me?.units ?? [])
const unitOptions = computed(() => [
  { value: '', label: 'Todas as unidades' },
  ...units.value.map((unit) => ({ value: unit.id, label: unit.name })),
])
const unitValue = computed({
  get: () => filters.value.unitId ?? '',
  set: (value: string) => applyFilters({ unitId: value || null }),
})

// Abas: "Eventos" só aparece se a organização tiver eventos (spec 07, seção 7).
watch(
  () => units.value.map((unit) => unit.id).join(','),
  () => {
    for (const unit of units.value) void events.load(unit.id)
  },
  { immediate: true },
)
const showEvents = computed(
  () => filters.value.tab === 'eventos' || units.value.some((unit) => events.hasEvents(unit.id)),
)
const tabs = computed(() =>
  HISTORY_TABS.filter((tab) => tab.value !== 'eventos' || showEvents.value),
)
function chooseTab(tab: HistoryTab) {
  applyFilters({ tab })
}

// Listas e totais: os totais são do período inteiro e vêm na primeira página (spec 07, seção 13).
const totals = ref<ReportTotals | null>(null)
const forbidden = ref(false)

function track<T extends { data?: { totals: ReportTotals }; error?: unknown }>(
  result: T,
  first: boolean,
  key: string,
): T {
  forbidden.value = isForbidden(result.error)
  if (result.data && first && key === listKey.value) totals.value = result.data.totals
  return result
}

const days = useCursorList<DayHistoryRow>(async (page) => {
  const key = listKey.value
  const result = await $api.GET('/api/v1/reports/days', {
    params: { query: { ...historyQuery(filters.value), ...page } },
  })
  return track(result, !page.cursor, key)
})
const sessions = useCursorList<ReportCashSessionLine>(async (page) => {
  const key = listKey.value
  const result = await $api.GET('/api/v1/reports/cash-sessions', {
    params: { query: { ...historyQuery(filters.value), ...page } },
  })
  return track(result, !page.cursor, key)
})
const eventRows = useCursorList<EventHistoryRow>(async (page) => {
  const key = listKey.value
  const result = await $api.GET('/api/v1/reports/events', {
    params: { query: { ...historyQuery(filters.value), ...page } },
  })
  return track(result, !page.cursor, key)
})

const listKey = computed(() => `${filters.value.tab}:${queryKey.value}`)
const current = computed(() =>
  filters.value.tab === 'caixas' ? sessions : filters.value.tab === 'eventos' ? eventRows : days,
)

watch(
  listKey,
  () => {
    totals.value = null
    void current.value.reset()
  },
  { immediate: true },
)
useRealtimeResync(() => current.value.reload())

const periodPath = computed(() => periodReportPath(filters.value))
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Relatórios</h1>
      <p class="text-text-muted">
        Quanto vendeu, recebeu e ficou no fiado, por dia, caixa e evento.
      </p>
    </div>

    <AppAlert v-if="forbidden" tone="error" data-testid="reports-forbidden">
      {{ FORBIDDEN_MESSAGE }}
    </AppAlert>
    <template v-else>
      <section class="flex flex-col gap-3" aria-label="Filtros">
        <div role="group" aria-label="Período" class="flex flex-wrap gap-2">
          <button
            v-for="preset in PERIOD_PRESETS"
            :key="preset.value"
            type="button"
            :aria-pressed="activePreset === preset.value"
            class="min-h-12 rounded-button border-2 px-4 font-bold"
            :class="
              activePreset === preset.value
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border-strong bg-surface'
            "
            :data-testid="`period-${preset.value}`"
            @click="choosePreset(preset.value)"
          >
            {{ preset.label }}
          </button>
          <button
            type="button"
            :aria-pressed="activePreset === null"
            :aria-expanded="customOpen"
            class="flex min-h-12 items-center gap-2 rounded-button border-2 px-4 font-bold"
            :class="
              activePreset === null
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border-strong bg-surface'
            "
            data-testid="period-custom"
            @click="openCustom"
          >
            <AppIcon name="calendar" />
            Escolher datas
          </button>
        </div>
        <form
          v-if="customOpen"
          class="grid grid-cols-1 gap-3 rounded-card border-2 border-border bg-surface p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
          novalidate
          @submit.prevent="applyCustom"
        >
          <AppTextField v-model="customFrom" type="date" label="De" />
          <AppTextField v-model="customTo" type="date" label="Até" />
          <AppButton type="submit" variant="secondary" :block="false" class="sm:mt-8">
            Aplicar
          </AppButton>
          <AppAlert v-if="customError" tone="error" class="sm:col-span-3">
            {{ customError }}
          </AppAlert>
        </form>
        <AppSelect
          v-if="units.length > 1"
          v-model="unitValue"
          label="Unidade"
          :options="unitOptions"
        />
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="totals-title">
        <div class="flex flex-wrap items-center gap-3">
          <h2 id="totals-title" class="min-w-0 flex-1 text-xl">
            Totais de {{ formatRange(filters) }}
          </h2>
          <AppButton
            variant="secondary"
            :block="false"
            :to="periodPath"
            data-testid="open-period-report"
          >
            <AppIcon name="chart" />
            Ver relatório do período
          </AppButton>
        </div>
        <p v-if="!totals && current.loading.value && !current.error.value" class="text-text-muted">
          Carregando…
        </p>
        <dl v-if="totals" class="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="period-totals">
          <ReportStat
            label="Venda"
            :value="formatCents(totals.salesCents)"
            :detail="plural(totals.tabCount, 'comanda', 'comandas')"
            strong
          />
          <ReportStat
            label="Recebido"
            :value="formatCents(totals.receivedCents)"
            :detail="receivedDetail(totals, formatCents)"
          />
          <ReportStat label="Pendurado" :value="formatCents(totals.onCreditCents)" />
          <ReportStat
            label="Perdas"
            :value="formatCents(totals.wasteCents)"
            :detail="plural(totals.wasteQuantity, 'unidade', 'unidades')"
          />
          <ReportStat label="Descontos" :value="formatCents(totals.discountsCents)" />
          <ReportStat
            label="Diferença de caixa"
            :value="differenceLabel(totals.cashDifferenceCents)"
          />
        </dl>
      </section>

      <section class="flex flex-col gap-3" aria-label="Histórico">
        <div role="tablist" aria-label="Histórico" class="flex gap-2">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            role="tab"
            :aria-selected="filters.tab === tab.value"
            class="min-h-12 flex-1 rounded-button border-2 px-4 font-bold"
            :class="
              filters.tab === tab.value
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border-strong bg-surface'
            "
            :data-testid="`tab-${tab.value}`"
            @click="chooseTab(tab.value)"
          >
            {{ tab.label }}
          </button>
        </div>

        <AppAlert v-if="current.error.value" tone="error">
          <p>{{ current.error.value }}</p>
          <button type="button" class="min-h-12 font-bold underline" @click="current.reload">
            Tentar de novo
          </button>
        </AppAlert>
        <p
          v-else-if="!current.loading.value && current.items.value.length === 0"
          class="text-text-muted"
          data-testid="history-empty"
        >
          <template v-if="filters.tab === 'caixas'">
            Nenhum caixa aberto neste período. Os caixas aparecem aqui depois de abertos.
          </template>
          <template v-else-if="filters.tab === 'eventos'">Nenhum evento neste período.</template>
          <template v-else>
            Nenhum dia com venda neste período. Os dias aparecem aqui quando um caixa é aberto.
          </template>
        </p>

        <!-- Dias -->
        <ul v-if="filters.tab === 'dias'" class="flex flex-col gap-2">
          <li v-for="row in days.items.value" :key="`${row.unitId}-${row.businessDate}`">
            <NuxtLink
              :to="
                periodReportPath({
                  unitId: row.unitId,
                  from: row.businessDate,
                  to: row.businessDate,
                })
              "
              class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-3 hover:border-border-strong"
              data-testid="history-row"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-bold">{{ formatDayWithWeekday(row.businessDate) }}</span>
                  <StageChip v-if="row.partial" status="preparing" label="Em andamento" />
                </span>
                <span class="text-sm text-text-muted">
                  {{ row.unitName }} · {{ plural(row.tabCount, 'comanda', 'comandas') }}
                </span>
                <span class="flex flex-wrap gap-x-3 text-sm">
                  <span>Recebido {{ formatCents(row.receivedCents) }}</span>
                  <span>Pendurado {{ formatCents(row.onCreditCents) }}</span>
                  <span>Caixa: {{ differenceLabel(row.cashDifferenceCents) }}</span>
                </span>
              </span>
              <span class="flex flex-col items-end">
                <span class="text-xs text-text-muted">Venda</span>
                <span class="font-display text-lg font-extrabold tabular-nums">{{
                  formatCents(row.salesCents)
                }}</span>
              </span>
              <AppIcon name="chevron-right" />
            </NuxtLink>
          </li>
        </ul>

        <!-- Caixas -->
        <ul v-else-if="filters.tab === 'caixas'" class="flex flex-col gap-2">
          <li v-for="row in sessions.items.value" :key="row.sessionId">
            <NuxtLink
              :to="`/painel/relatorios/caixas/${row.sessionId}`"
              class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-3 hover:border-border-strong"
              data-testid="history-row"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-bold">{{ row.name }}</span>
                  <StageChip v-if="row.status === 'open'" status="preparing" label="Aberto" />
                </span>
                <span class="text-sm text-text-muted">
                  {{ formatDay(row.businessDate) }} · {{ row.unitName }} ·
                  {{ actorName(row.responsible) }} · {{ formatTime(row.openedAt) }}
                  <template v-if="row.closedAt"> às {{ formatTime(row.closedAt) }}</template>
                </span>
                <span class="flex flex-wrap gap-x-3 text-sm">
                  <span v-if="row.status === 'closed'"
                    >Caixa: {{ differenceLabel(row.differenceCents) }}</span
                  >
                  <span v-if="row.pendingTabsCount"
                    >{{ plural(row.pendingTabsCount, 'comanda pendente', 'comandas pendentes') }}
                  </span>
                </span>
              </span>
              <span class="flex flex-col items-end">
                <span class="text-xs text-text-muted">Recebido</span>
                <span class="font-display text-lg font-extrabold tabular-nums">{{
                  formatCents(row.receivedCents)
                }}</span>
              </span>
              <AppIcon name="chevron-right" />
            </NuxtLink>
          </li>
        </ul>

        <!-- Eventos -->
        <ul v-else class="flex flex-col gap-2">
          <li v-for="row in eventRows.items.value" :key="row.eventId">
            <NuxtLink
              :to="`/painel/relatorios/eventos/${row.eventId}`"
              class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-3 hover:border-border-strong"
              data-testid="history-row"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-bold">{{ row.contractorName }}</span>
                  <StageChip
                    :status="row.status === 'in_progress' ? 'preparing' : 'delivered'"
                    :label="EVENT_STATUS_LABELS[row.status]"
                  />
                </span>
                <span class="text-sm text-text-muted">
                  {{ eventDates(row) }} · {{ row.unitName }}
                </span>
                <span class="text-sm">Consumo: {{ consumptionLabel(row) }}</span>
              </span>
              <span class="flex flex-col items-end">
                <span class="text-xs text-text-muted">Venda</span>
                <span class="font-display text-lg font-extrabold tabular-nums">{{
                  formatCents(row.salesCents)
                }}</span>
              </span>
              <AppIcon name="chevron-right" />
            </NuxtLink>
          </li>
        </ul>

        <LoadMoreButton
          v-if="current.hasMore.value"
          :loading="current.loadingMore.value"
          @click="current.loadMore"
        />
      </section>
    </template>
  </PanelShell>
</template>
