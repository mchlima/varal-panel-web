<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { formatDateTime, formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { CASH_MOVEMENT_LABELS, PAYMENT_METHOD_LABELS, differenceLabel } from '~/lib/payment'
import {
  FORBIDDEN_MESSAGE,
  actorName,
  formatDayWithWeekday,
  isForbidden,
  plural,
  type CashSessionReport,
} from '~/lib/report'

/**
 * Relatório do caixa (`/painel/relatorios/caixas/{id}`, spec 07, seção 5): uma abertura de
 * caixa, do fundo de troco à conferência. Trata só do dinheiro que passou por ela (RN-07.09):
 * não tem "venda", porque uma comanda pode ser paga em mais de um caixa. Aberta, os valores são
 * parciais (RN-07.06). Só do dono, inclusive o caixa que um colaborador fechou (RN-07.07).
 */
const route = useRoute()
const { $api } = useNuxtApp()
const id = computed(() => String(route.params.id))

const report = ref<CashSessionReport | null>(null)
const loadError = ref('')
const notFound = ref(false)
const forbidden = ref(false)
const loading = ref(false)

useHead({
  title: () =>
    report.value
      ? `${report.value.session.name} · Relatórios · Varal`
      : 'Relatório do caixa · Varal',
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const { data, error, response } = await $api.GET('/api/v1/cash-register-sessions/{id}/report', {
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

// Aberta: cada pagamento, estorno ou movimento muda os valores (RN-07.06).
let timer: ReturnType<typeof setTimeout> | null = null
function reloadSoon(registerId: string) {
  if (!report.value?.partial || registerId !== report.value.session.cashRegisterId) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), 1000)
}
onScopeDispose(() => {
  if (timer) clearTimeout(timer)
})
useRealtimeEvent('cash_register.updated', (event) => reloadSoon(event.data.id))
useRealtimeEvent('cash_register.closed', (event) => reloadSoon(event.data.id))

const backTo = computed(() => {
  const back = import.meta.client ? (window.history.state?.back as unknown) : null
  return typeof back === 'string' && back.startsWith('/painel/relatorios')
    ? back
    : '/painel/relatorios?aba=caixas'
})

const session = computed(() => report.value?.session ?? null)
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
    <AppAlert v-else-if="notFound" tone="error">Caixa não encontrado.</AppAlert>
    <AppAlert v-else-if="loadError" tone="error">
      <p>{{ loadError }}</p>
      <button type="button" class="min-h-12 font-bold underline" @click="load">
        Tentar de novo
      </button>
    </AppAlert>
    <p v-else-if="!report" class="text-text-muted">Carregando relatório…</p>

    <template v-if="report && session">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl">{{ session.name }}</h1>
        <p class="text-text-muted">
          {{ report.unitName }} · dia {{ formatDayWithWeekday(session.businessDate) }}
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
        <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt class="inline text-text-muted">Abriu:</dt>
            <dd class="ml-1 inline">
              {{ actorName(report.responsible) }} · {{ formatDateTime(session.openedAt) }}
            </dd>
          </div>
          <div>
            <dt class="inline text-text-muted">Fechou:</dt>
            <dd class="ml-1 inline">
              <template v-if="session.closedAt">
                {{ actorName(report.closedByActor) }} · {{ formatDateTime(session.closedAt) }}
              </template>
              <template v-else>Aberto</template>
            </dd>
          </div>
        </dl>
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ReportStat
            label="Recebido"
            :value="formatCents(report.totals.receivedCents)"
            :detail="`vendas ${formatCents(report.totals.receivedSalesCents)} · quitações ${formatCents(report.totals.receivedSettlementsCents)}`"
            strong
          />
          <ReportStat label="Fundo de troco" :value="formatCents(session.openingFloatCents)" />
          <ReportStat
            label="Diferença total"
            :value="session.status === 'closed' ? differenceLabel(session.differenceCents) : '—'"
            :detail="session.status === 'closed' ? undefined : 'aparece no fechamento'"
          />
        </dl>
      </section>

      <!-- Por forma -->
      <ReportSection
        title="Por forma"
        :aside="session.status === 'closed' ? differenceLabel(session.differenceCents) : undefined"
        open
        data-testid="report-methods"
      >
        <ul class="flex flex-col divide-y divide-border text-sm">
          <li
            v-for="line in report.byMethod"
            :key="line.method"
            class="flex flex-wrap items-baseline gap-x-3 py-2"
          >
            <span class="min-w-0 flex-1">
              <span class="font-bold">{{ PAYMENT_METHOD_LABELS[line.method] }}</span>
              <span class="block text-text-muted tabular-nums">
                esperado {{ formatCents(line.expectedCents) }}
                <template v-if="line.informedCents !== null">
                  · informado {{ formatCents(line.informedCents) }}</template
                >
              </span>
              <span class="block text-text-muted tabular-nums">
                vendas {{ formatCents(line.salesCents) }} · quitações
                {{ formatCents(line.settlementsCents) }}
              </span>
            </span>
            <span
              v-if="line.differenceCents !== null"
              class="font-bold whitespace-nowrap tabular-nums"
              :class="line.differenceCents === 0 ? '' : 'text-error'"
              >{{ differenceLabel(line.differenceCents) }}</span
            >
          </li>
        </ul>
        <p v-if="session.closingNote" class="text-sm">
          Observação do fechamento: {{ session.closingNote }}
        </p>
      </ReportSection>

      <!-- Movimentos -->
      <ReportSection
        title="Sangrias e suprimentos"
        :aside="plural(report.movements.length, 'movimento', 'movimentos')"
        data-testid="report-movements"
      >
        <p v-if="report.movements.length === 0" class="text-sm text-text-muted">
          Nenhuma sangria ou suprimento.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="movement in report.movements"
            :key="movement.id"
            class="flex flex-wrap items-baseline gap-x-3 py-2"
          >
            <span class="min-w-0 flex-1">
              <span class="font-bold">{{ CASH_MOVEMENT_LABELS[movement.type] }}</span>
              <span class="block text-sm text-text-muted">
                {{ movement.reason }} · {{ actorName(movement.createdBy) }} às
                {{ formatTime(movement.createdAt) }}
              </span>
            </span>
            <span class="font-bold tabular-nums"
              >{{ movement.type === 'withdrawal' ? '−' : '+' }}
              {{ formatCents(movement.amountCents) }}</span
            >
          </li>
        </ul>
      </ReportSection>

      <!-- Pagamentos -->
      <ReportSection
        title="Pagamentos"
        :aside="plural(report.payments.length, 'pagamento', 'pagamentos')"
        data-testid="report-payments"
      >
        <p v-if="report.payments.length === 0" class="text-sm text-text-muted">
          Nenhum pagamento recebido neste caixa.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="payment in report.payments"
            :key="payment.paymentId"
            class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
          >
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-2 font-bold">
                Comanda {{ payment.tabNumber }} · {{ payment.customerName }}
                <StageChip v-if="payment.reversedAt" status="canceled" label="Estornado" />
                <StageChip v-if="payment.isCreditSettlement" status="closing" label="Quitação" />
              </span>
              <span class="block text-sm text-text-muted">
                {{ PAYMENT_METHOD_LABELS[payment.method] }}
                <template v-if="payment.changeCents">
                  · troco {{ formatCents(payment.changeCents) }}</template
                >
                · {{ actorName(payment.receivedBy) }} às {{ formatTime(payment.receivedAt) }}
                <template v-if="payment.reversalReason">
                  · estorno: {{ payment.reversalReason }}</template
                >
              </span>
            </span>
            <span
              class="font-bold tabular-nums"
              :class="payment.reversedAt ? 'text-text-muted line-through' : ''"
              >{{ formatCents(payment.amountCents) }}</span
            >
          </li>
        </ul>
      </ReportSection>

      <!-- Pendentes no fechamento (RN-05.28) -->
      <section
        v-if="report.pending"
        class="flex flex-col gap-1 rounded-card border-2 border-border bg-surface p-4"
        data-testid="report-pending"
      >
        <h2 class="font-display text-lg font-bold">Comandas pendentes no fechamento</h2>
        <p>
          {{ plural(report.pending.count, 'comanda seguiu aberta', 'comandas seguiram abertas') }}
          · {{ formatCents(report.pending.totalCents) }}
        </p>
        <p class="text-sm text-text-muted">
          Elas continuaram no varal para o dia seguinte ou para outro caixa aberto.
        </p>
      </section>
    </template>
  </PanelShell>
</template>
