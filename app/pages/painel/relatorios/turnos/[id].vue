<script setup lang="ts">
import { apiErrorMessage } from '~/lib/api-error'
import { customerLabel } from '~/lib/customer'
import { formatDateTime, formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { MODALITY_LABELS, SHIFT_TYPE_LABELS, TAB_STATUS_LABELS } from '~/lib/operation'
import { PAYMENT_METHOD_LABELS, differenceLabel } from '~/lib/payment'
import {
  FORBIDDEN_MESSAGE,
  actorName,
  agreementDifferenceLabel,
  formatDayWithWeekday,
  isForbidden,
  plural,
  type ShiftReport,
} from '~/lib/report'

/**
 * Relatório do turno (`/painel/relatorios/turnos/{id}`, spec 07, seções 4 e 9): resumo no
 * topo e as demais seções recolhíveis, para caber no celular. Com o turno aberto, os valores
 * são parciais e a faixa avisa (RN-07.06); a tela recarrega quando algo muda na unidade. Só do
 * dono (RN-07.07): o colaborador recebe 403 da API.
 */
const route = useRoute()
const { $api } = useNuxtApp()
const id = computed(() => String(route.params.id))

const report = ref<ShiftReport | null>(null)
const loadError = ref('')
const notFound = ref(false)
const forbidden = ref(false)
const loading = ref(false)

useHead({
  title: () =>
    report.value
      ? `Turno de ${formatDayWithWeekday(report.value.shift.date)} · Relatórios · Varal`
      : 'Relatório do turno · Varal',
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const { data, error, response } = await $api.GET('/api/v1/shifts/{id}/report', {
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

// Turno aberto: os valores mudam com a operação; recarrega pouco depois de cada mudança.
let timer: ReturnType<typeof setTimeout> | null = null
function reloadSoon(unitId: string) {
  if (!report.value?.partial || unitId !== report.value.shift.unitId) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), 1000)
}
onScopeDispose(() => {
  if (timer) clearTimeout(timer)
})
useRealtimeEvent('tab.created', (event) => reloadSoon(event.unitId))
useRealtimeEvent('tab.updated', (event) => reloadSoon(event.unitId))
useRealtimeEvent('order.created', (event) => reloadSoon(event.unitId))
useRealtimeEvent('order_item.canceled', (event) => reloadSoon(event.unitId))
useRealtimeEvent('cash_register.updated', (event) => reloadSoon(event.unitId))
useRealtimeEvent('cash_register.closed', (event) => reloadSoon(event.unitId))
useRealtimeEvent('shift.closed', (event) => reloadSoon(event.unitId))

/** Volta ao histórico com os filtros de onde veio, se veio de lá. */
const backTo = computed(() => {
  const back = import.meta.client ? (window.history.state?.back as unknown) : null
  return typeof back === 'string' && back.startsWith('/painel/relatorios?')
    ? back
    : '/painel/relatorios'
})

const summary = computed(() => report.value?.summary ?? null)
const productsTotal = computed(() =>
  (report.value?.products ?? []).reduce((sum, line) => sum + line.valueCents, 0),
)
const paymentTotals = computed(() => {
  const lines = report.value?.paymentMethods ?? []
  return {
    salesCents: lines.reduce((sum, line) => sum + line.salesCents, 0),
    settlementsCents: lines.reduce((sum, line) => sum + line.settlementsCents, 0),
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
  }
})
const cancellationCount = computed(
  () =>
    (report.value?.cancellations.items.length ?? 0) +
    (report.value?.cancellations.tabs.length ?? 0),
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
    <AppAlert v-else-if="notFound" tone="error">Turno não encontrado.</AppAlert>
    <AppAlert v-else-if="loadError" tone="error">
      <p>{{ loadError }}</p>
      <button type="button" class="min-h-12 font-bold underline" @click="load">
        Tentar de novo
      </button>
    </AppAlert>
    <p v-else-if="!report" class="text-text-muted">Carregando relatório…</p>

    <template v-if="report && summary">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl">Turno de {{ formatDayWithWeekday(report.shift.date) }}</h1>
        <p class="text-text-muted">
          {{ report.shift.unitName }} · {{ SHIFT_TYPE_LABELS[report.shift.type] }}
        </p>
      </div>

      <!-- RN-07.06 -->
      <div
        v-if="report.partial"
        role="status"
        class="flex flex-wrap items-center gap-3 rounded-card bg-status-preparing-bg px-4 py-3 font-bold text-status-preparing-text"
        data-testid="report-partial"
      >
        <AppIcon name="clock" />
        <span class="flex-1">Turno em andamento — valores parciais</span>
        <button
          type="button"
          class="flex min-h-12 items-center gap-2 underline"
          :disabled="loading"
          @click="load"
        >
          <AppIcon name="refresh" />
          Atualizar
        </button>
      </div>

      <!-- Resumo -->
      <section
        class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
        aria-labelledby="summary-title"
        data-testid="report-summary"
      >
        <h2 id="summary-title" class="font-display text-lg font-bold">Resumo</h2>
        <dl class="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt class="inline text-text-muted">Abertura:</dt>
            <dd class="inline">
              {{ formatDateTime(report.shift.openedAt) }} por {{ actorName(report.shift.openedBy) }}
            </dd>
          </div>
          <div>
            <dt class="inline text-text-muted">Fechamento:</dt>
            <dd class="inline">
              <template v-if="report.shift.closedAt">
                {{ formatDateTime(report.shift.closedAt) }} por
                {{ actorName(report.shift.closedBy) }}
              </template>
              <template v-else>em andamento</template>
            </dd>
          </div>
        </dl>
        <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ReportStat
            label="Venda"
            :value="formatCents(summary.salesCents)"
            :detail="plural(summary.tabCount, 'comanda', 'comandas')"
            strong
          />
          <ReportStat label="Ticket médio" :value="formatCents(summary.averageTicketCents)" />
          <ReportStat label="Descontos" :value="formatCents(summary.discountsCents)" />
          <ReportStat
            label="Recebido"
            :value="formatCents(summary.receivedCents)"
            :detail="`vendas ${formatCents(summary.receivedSalesCents)} · quitações ${formatCents(summary.receivedSettlementsCents)}`"
          />
          <ReportStat label="Pendurado" :value="formatCents(summary.onCreditCents)" />
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
        </dl>
      </section>

      <!-- Acordo (turno contratado) -->
      <ReportSection
        v-if="report.agreement"
        title="Acordo"
        :aside="agreementDifferenceLabel(report.agreement.quantityDifference)"
        open
        data-testid="report-agreement"
      >
        <p class="font-bold">
          {{ report.agreement.contractorName }} ·
          {{ MODALITY_LABELS[report.agreement.modality] }}
        </p>
        <dl class="grid grid-cols-2 gap-2">
          <ReportStat
            label="Quantidade combinada"
            :value="
              report.agreement.agreedQuantity === null
                ? '—'
                : String(report.agreement.agreedQuantity)
            "
          />
          <ReportStat label="Consumida" :value="String(report.agreement.consumedQuantity)" />
          <ReportStat
            label="Valor combinado"
            :value="
              report.agreement.agreedAmountCents === null
                ? '—'
                : formatCents(report.agreement.agreedAmountCents)
            "
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
        <p v-if="report.agreement.limits" class="text-sm">Limites: {{ report.agreement.limits }}</p>
        <p v-if="report.agreement.notes" class="text-sm">
          Observação: {{ report.agreement.notes }}
        </p>
      </ReportSection>

      <!-- Por produto -->
      <ReportSection
        title="Por produto"
        :aside="formatCents(productsTotal)"
        data-testid="report-products"
      >
        <p v-if="report.products.length === 0" class="text-text-muted">Nenhum item vendido.</p>
        <p v-else class="text-sm text-text-muted">
          Valores antes do desconto da comanda (o desconto está no resumo).
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="line in report.products"
            :key="`${line.productId}-${line.productName}`"
            class="flex flex-col gap-1 py-2"
          >
            <div class="flex items-baseline gap-3">
              <span class="min-w-0 flex-1 font-bold">{{ line.productName }}</span>
              <span class="text-sm whitespace-nowrap text-text-muted tabular-nums"
                >{{ line.quantity }} un.</span
              >
              <span class="font-bold whitespace-nowrap tabular-nums">{{
                formatCents(line.valueCents)
              }}</span>
            </div>
            <ul v-if="line.modifiers.length" class="flex flex-col gap-0.5 pl-3 text-sm">
              <li
                v-for="modifier in line.modifiers"
                :key="`${modifier.groupName}-${modifier.modifierName}`"
                class="flex items-baseline gap-3 text-text-muted"
              >
                <span class="min-w-0 flex-1"
                  >+ {{ modifier.modifierName }} ({{ modifier.groupName }})</span
                >
                <span class="whitespace-nowrap tabular-nums">{{ modifier.quantity }} un.</span>
                <span class="whitespace-nowrap tabular-nums">{{
                  formatCents(modifier.valueCents)
                }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </ReportSection>

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
          Vendas: pagamentos das comandas deste turno. Quitações: fiado recebido neste turno, de
          qualquer turno.
        </p>
      </ReportSection>

      <!-- Por colaborador -->
      <ReportSection
        title="Por colaborador"
        :aside="plural(report.staff.length, 'pessoa', 'pessoas')"
        data-testid="report-staff"
      >
        <p v-if="report.staff.length === 0" class="text-text-muted">Ninguém operou neste turno.</p>
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
        :aside="differenceLabel(summary.cashDifferenceCents)"
        data-testid="report-registers"
      >
        <p v-if="report.cashRegisters.length === 0" class="text-text-muted">
          Nenhum caixa aberto neste turno.
        </p>
        <article
          v-for="register in report.cashRegisters"
          :key="register.id"
          class="flex flex-col gap-2 rounded-card bg-surface-muted px-3 py-2"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="min-w-0 flex-1 font-bold">{{ register.name }}</h3>
            <StageChip
              :status="register.status === 'open' ? 'preparing' : 'delivered'"
              :label="register.status === 'open' ? 'Aberto' : 'Fechado'"
            />
          </div>
          <p class="text-sm text-text-muted">
            Responsável: {{ actorName(register.responsible) }} · aberto às
            {{ formatTime(register.openedAt) }}
            <template v-if="register.closedAt">
              · fechado às {{ formatTime(register.closedAt) }}
              <template v-if="register.closedByActor">
                por {{ actorName(register.closedByActor) }}</template
              >
            </template>
          </p>
          <dl class="grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-4">
            <div>
              <dt class="text-text-muted">Fundo</dt>
              <dd class="tabular-nums">{{ formatCents(register.openingFloatCents) }}</dd>
            </div>
            <div>
              <dt class="text-text-muted">Sangrias</dt>
              <dd class="tabular-nums">{{ formatCents(register.cash.withdrawalsCents) }}</dd>
            </div>
            <div>
              <dt class="text-text-muted">Suprimentos</dt>
              <dd class="tabular-nums">{{ formatCents(register.cash.depositsCents) }}</dd>
            </div>
            <div>
              <dt class="text-text-muted">Quitações de fiado</dt>
              <dd class="tabular-nums">{{ formatCents(register.creditSettlementsCents) }}</dd>
            </div>
          </dl>
          <div class="overflow-x-auto">
            <table class="w-full text-sm tabular-nums">
              <thead>
                <tr class="text-left text-text-muted">
                  <th scope="col" class="py-1 pr-2 font-normal">Forma</th>
                  <th scope="col" class="py-1 pr-2 text-right font-normal">Esperado</th>
                  <th
                    v-if="register.counts.length"
                    scope="col"
                    class="py-1 pr-2 text-right font-normal"
                  >
                    Informado
                  </th>
                  <th v-if="register.counts.length" scope="col" class="py-1 text-right font-normal">
                    Diferença
                  </th>
                </tr>
              </thead>
              <tbody>
                <template v-if="register.counts.length">
                  <tr
                    v-for="count in register.counts"
                    :key="count.method"
                    class="border-t border-border"
                  >
                    <th scope="row" class="py-1.5 pr-2 text-left font-bold">
                      {{ PAYMENT_METHOD_LABELS[count.method] }}
                    </th>
                    <td class="py-1.5 pr-2 text-right">{{ formatCents(count.expectedCents) }}</td>
                    <td class="py-1.5 pr-2 text-right">{{ formatCents(count.informedCents) }}</td>
                    <td
                      class="py-1.5 text-right font-bold"
                      :class="count.differenceCents === 0 ? '' : 'text-error'"
                    >
                      {{ differenceLabel(count.differenceCents) }}
                    </td>
                  </tr>
                </template>
                <template v-else>
                  <tr
                    v-for="expected in register.expected"
                    :key="expected.method"
                    class="border-t border-border"
                  >
                    <th scope="row" class="py-1.5 pr-2 text-left font-bold">
                      {{ PAYMENT_METHOD_LABELS[expected.method] }}
                    </th>
                    <td class="py-1.5 pr-2 text-right">
                      {{ formatCents(expected.expectedCents) }}
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p v-if="register.status === 'closed'" class="text-sm font-bold">
            Diferença total: {{ differenceLabel(register.differenceCents) }}
          </p>
          <p v-if="register.closingNote" class="text-sm">Observação: {{ register.closingNote }}</p>
        </article>
      </ReportSection>

      <!-- Fiado -->
      <ReportSection
        title="Fiado"
        :aside="formatCents(report.credit.onCreditCents)"
        data-testid="report-credit"
      >
        <h3 class="font-bold">
          Pendurado no turno · {{ formatCents(report.credit.onCreditCents) }}
        </h3>
        <p v-if="report.credit.tabs.length === 0" class="text-sm text-text-muted">
          Nenhuma comanda pendurada neste turno.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="tab in report.credit.tabs"
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
                Comanda {{ tab.number }} · às {{ formatTime(tab.creditAt) }} ·
                {{ TAB_STATUS_LABELS[tab.status] }}
                <template v-if="tab.status === 'on_credit'">
                  · deve {{ formatCents(tab.balanceCents) }}</template
                >
              </span>
            </span>
            <span class="font-bold tabular-nums">{{ formatCents(tab.amountCents) }}</span>
          </li>
        </ul>
        <h3 class="font-bold">
          Quitações recebidas · {{ formatCents(report.credit.settlementsCents) }}
        </h3>
        <p v-if="report.credit.settlements.length === 0" class="text-sm text-text-muted">
          Nenhuma quitação recebida neste turno.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="settlement in report.credit.settlements"
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
                Comanda {{ settlement.tabNumber }}
                <template v-if="settlement.tabShiftId !== report.shift.id">
                  (de outro turno)</template
                >
                · {{ PAYMENT_METHOD_LABELS[settlement.method] }} · às
                {{ formatTime(settlement.receivedAt) }} por
                {{ actorName(settlement.receivedBy) }}
              </span>
            </span>
            <span class="font-bold tabular-nums">{{ formatCents(settlement.amountCents) }}</span>
          </li>
        </ul>
      </ReportSection>

      <!-- Cancelamentos e perdas -->
      <ReportSection
        title="Cancelamentos e perdas"
        :aside="plural(cancellationCount, 'cancelamento', 'cancelamentos')"
        data-testid="report-cancellations"
      >
        <p class="text-sm">
          Perdas: <strong>{{ formatCents(report.cancellations.wasteCents) }}</strong> ({{
            plural(report.cancellations.wasteQuantity, 'unidade', 'unidades')
          }})
        </p>
        <h3 class="font-bold">Itens cancelados</h3>
        <p v-if="report.cancellations.items.length === 0" class="text-sm text-text-muted">
          Nenhum item cancelado.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li
            v-for="item in report.cancellations.items"
            :key="item.itemId"
            class="flex flex-col gap-1 py-2"
          >
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="min-w-0 flex-1 font-bold">
                {{ item.quantity }}× {{ item.productName }}
              </span>
              <StageChip v-if="item.wasted" status="late" label="Perda" />
              <span class="font-bold tabular-nums">{{ formatCents(item.valueCents) }}</span>
            </div>
            <p class="text-sm text-text-muted">
              Comanda {{ item.tabNumber }} · às {{ formatTime(item.canceledAt) }} por
              {{ actorName(item.canceledBy) }}
              <template v-if="item.reason"> · motivo: {{ item.reason }}</template>
            </p>
          </li>
        </ul>
        <h3 class="font-bold">Comandas canceladas</h3>
        <p v-if="report.cancellations.tabs.length === 0" class="text-sm text-text-muted">
          Nenhuma comanda cancelada.
        </p>
        <ul class="flex flex-col divide-y divide-border">
          <li v-for="tab in report.cancellations.tabs" :key="tab.tabId" class="flex flex-col py-2">
            <span class="font-bold">Comanda {{ tab.number }} · {{ tab.customerName }}</span>
            <span class="text-sm text-text-muted">
              <template v-if="tab.canceledAt">às {{ formatTime(tab.canceledAt) }} </template>
              <template v-if="tab.canceledBy">por {{ actorName(tab.canceledBy) }}</template>
            </span>
          </li>
        </ul>
      </ReportSection>
    </template>
  </PanelShell>
</template>
