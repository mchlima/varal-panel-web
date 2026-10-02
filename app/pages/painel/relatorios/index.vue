<script setup lang="ts">
import { formatCents } from '~/lib/money'
import { SHIFT_TYPE_LABELS } from '~/lib/operation'
import { differenceLabel } from '~/lib/payment'
import {
  FORBIDDEN_MESSAGE,
  PERIOD_PRESETS,
  filtersFromQuery,
  filtersToQuery,
  formatDayWithWeekday,
  formatRange,
  historyQuery,
  isForbidden,
  plural,
  presetOf,
  presetRange,
  rangeError,
  todayInSaoPaulo,
  type HistoryFilters,
  type PeriodPreset,
  type ShiftHistoryRow,
  type ShiftHistoryTotals,
} from '~/lib/report'

/**
 * Histórico de turnos (`/painel/relatorios`, spec 07, seção 5): totais do período no topo e a
 * lista de turnos, mais recentes primeiro, com "Carregar mais" por cursor. Filtros de período
 * (atalhos ou datas), unidade e tipo ficam na URL, para voltar do relatório de um turno com
 * os mesmos filtros. Só do dono (RN-07.07): o colaborador recebe 403 da API.
 */
useHead({ title: 'Relatórios · Varal' })

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const { $api } = useNuxtApp()

const today = todayInSaoPaulo()
const filters = computed(() => filtersFromQuery(route.query, today))
const filterKey = computed(() => JSON.stringify(historyQuery(filters.value)))

function applyFilters(next: Partial<HistoryFilters>) {
  void router.replace({ query: filtersToQuery({ ...filters.value, ...next }) })
}

// Período
const activePreset = computed(() => presetOf(filters.value, today))
function choosePreset(preset: PeriodPreset) {
  customOpen.value = false
  applyFilters(presetRange(preset, today))
}
const customOpen = ref(false)
const customFrom = ref(filters.value.from)
const customTo = ref(filters.value.to)
const customError = ref('')
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

// Unidade e tipo
const units = computed(() => session.me?.units ?? [])
const unitOptions = computed(() => [
  { value: '', label: 'Todas as unidades' },
  ...units.value.map((unit) => ({ value: unit.id, label: unit.name })),
])
const unitValue = computed({
  get: () => filters.value.unitId ?? '',
  set: (value: string) => applyFilters({ unitId: value || null }),
})
const typeOptions = [
  { value: '', label: 'Todos os tipos' },
  { value: 'direct_sale', label: SHIFT_TYPE_LABELS.direct_sale },
  { value: 'contracted', label: SHIFT_TYPE_LABELS.contracted },
]
const typeValue = computed({
  get: () => filters.value.type ?? '',
  set: (value: string) =>
    applyFilters({ type: value === 'direct_sale' || value === 'contracted' ? value : null }),
})

// Lista e totais
const totals = ref<ShiftHistoryTotals | null>(null)
const forbidden = ref(false)
const list = useCursorList<ShiftHistoryRow>(async (page) => {
  const key = filterKey.value
  const result = await $api.GET('/api/v1/reports/shifts', {
    params: { query: { ...historyQuery(filters.value), ...page } },
  })
  forbidden.value = isForbidden(result.error)
  // Os totais são do período inteiro (spec 07, seção 11): vêm na primeira página.
  if (result.data && !page.cursor && key === filterKey.value) totals.value = result.data.totals
  return result
})
watch(
  filterKey,
  () => {
    totals.value = null
    void list.reset()
  },
  { immediate: true },
)
useRealtimeResync(() => list.reload())

const receivedDetail = (row: { receivedSalesCents: number; receivedSettlementsCents: number }) =>
  `vendas ${formatCents(row.receivedSalesCents)} · quitações ${formatCents(row.receivedSettlementsCents)}`
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Relatórios</h1>
      <p class="text-text-muted">Histórico de turnos: quanto vendeu, recebeu e ficou no fiado.</p>
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
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AppSelect
            v-if="units.length > 1"
            v-model="unitValue"
            label="Unidade"
            :options="unitOptions"
          />
          <AppSelect v-model="typeValue" label="Tipo do turno" :options="typeOptions" />
        </div>
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="totals-title">
        <h2 id="totals-title" class="text-xl">Totais de {{ formatRange(filters) }}</h2>
        <p v-if="!totals && list.loading.value && !list.error.value" class="text-text-muted">
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
            :detail="receivedDetail(totals)"
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
            :detail="plural(totals.shiftCount, 'turno', 'turnos')"
          />
        </dl>
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="shifts-title">
        <h2 id="shifts-title" class="text-xl">Turnos</h2>
        <AppAlert v-if="list.error.value" tone="error">
          <p>{{ list.error.value }}</p>
          <button type="button" class="min-h-12 font-bold underline" @click="list.reload">
            Tentar de novo
          </button>
        </AppAlert>
        <p v-else-if="!list.loading.value && list.items.value.length === 0" class="text-text-muted">
          Nenhum turno neste período.
        </p>
        <ul class="flex flex-col gap-2">
          <li v-for="row in list.items.value" :key="row.shiftId">
            <NuxtLink
              :to="`/painel/relatorios/turnos/${row.shiftId}`"
              class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-3 hover:border-border-strong"
              data-testid="history-row"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-bold">{{ formatDayWithWeekday(row.date) }}</span>
                  <StageChip v-if="row.status === 'open'" status="preparing" label="Em andamento" />
                </span>
                <span class="text-sm text-text-muted">
                  {{ row.unitName }} · {{ SHIFT_TYPE_LABELS[row.type] }} ·
                  {{ plural(row.tabCount, 'comanda', 'comandas') }}
                </span>
                <span class="flex flex-wrap gap-x-3 text-sm">
                  <span>Recebido {{ formatCents(row.receivedCents) }}</span>
                  <span>Pendurado {{ formatCents(row.onCreditCents) }}</span>
                  <span v-if="row.status === 'closed'"
                    >Caixa: {{ differenceLabel(row.cashDifferenceCents) }}</span
                  >
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
        <LoadMoreButton
          v-if="list.hasMore.value"
          :loading="list.loadingMore.value"
          @click="list.loadMore"
        />
      </section>
    </template>
  </PanelShell>
</template>
