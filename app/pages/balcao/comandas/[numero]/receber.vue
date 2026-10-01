<script setup lang="ts">
import { formatTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import { TAB_STATUS_LABELS, type Tab } from '~/lib/operation'
import { pendingLabel, pendingOperations } from '~/lib/operation-actions'
import type { QueueOutcome } from '~/lib/offline-queue'
import {
  PAYMENT_METHOD_LABELS,
  REASON_MAX,
  applyDraftPayments,
  cashChange,
  confirmPaymentLabel,
  discountLabel,
  isActivePayment,
  paymentIssue,
  toPaymentBody,
  type DiscountType,
  type Payment,
  type PaymentMethod,
  type PaymentResult,
} from '~/lib/payment'

/**
 * Receber (`/balcao/comandas/{numero}/receber`, spec 05, seção 8): total, desconto, pagamentos
 * feitos e saldo em destaque; botões grandes das formas, teclado numérico e troco em letra
 * grande no dinheiro (RN-05.09); escolha do caixa quando houver mais de um (RN-05.05); estorno
 * com motivo (RN-05.13 a 05.15). Quando o saldo zera, a comanda fica paga e sai do varal
 * (RN-05.10, CA-05.01).
 *
 * Pagamento, estorno e desconto vão pela fila local (spec 01, seção 11) com a
 * `Idempotency-Key` gerada na hora. Um pagamento na fila aparece como "não confirmado" e não
 * mexe no saldo nem na situação da comanda: só a resposta, o evento ou o REST mudam isso.
 */
const route = useRoute()
const number = computed(() => Number(route.params.numero))
const { place, counter } = useCounterLive()
const { tab, notFound, error, reloadSoon } = useTabDetail(number)
const connection = useConnectionStore()
const operations = useOperations()
const session = useSessionStore()

useHead({ title: () => `Receber · comanda ${number.value} · Varal` })

const shiftId = computed(() => counter.shift?.id ?? null)
const unitId = computed(() => place.value?.unit.id ?? null)
const cash = useCashRegisters(shiftId, unitId)
const canOpenRegister = computed(() => session.isOwner || place.value?.unit.canOperateCash === true)

const tabId = computed(() => tab.value?.id ?? null)
const method = ref<PaymentMethod | null>(null)
const cents = ref(0)
const sending = ref(false)
const payError = ref('')
const notice = ref('')
/** Último troco entregue, em destaque até o próximo pagamento (RN-05.09). */
const lastChange = ref<{ cents: number; confirmed: boolean } | null>(null)

/** Com rede a resposta chega rápido; passado isso, o pagamento segue na fila. */
const WAIT_FOR_PAYMENT_MS = 2_500

/**
 * Ações cuja recusa já foi explicada na própria tela (resposta dentro da espera): saem da faixa
 * do topo sem aviso repetido.
 */
const explainedInline = new Set<string>()
const waitingKey = ref<string | null>(null)

async function waitOutcome(key: string, settled: Promise<QueueOutcome>) {
  waitingKey.value = key
  try {
    const outcome = connection.online
      ? await Promise.race([
          settled,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_FOR_PAYMENT_MS)),
        ])
      : null
    if (outcome && !outcome.ok) explainedInline.add(key)
    return outcome
  } finally {
    waitingKey.value = null
  }
}

const payments = computed<Payment[]>(() => tab.value?.payments ?? [])
const pendingPayments = computed(() =>
  pendingOperations(
    connection.pending,
    (meta) => meta.kind === 'tab.payment' && meta.tabId === tabId.value,
  ).map((op) => ({
    key: op.action.idempotencyKey,
    label: pendingLabel(op.action, connection.online),
    meta: op.meta as Extract<typeof op.meta, { kind: 'tab.payment' }>,
  })),
)
const pendingReversals = computed(() => {
  const result: Record<string, string> = {}
  for (const op of pendingOperations(
    connection.pending,
    (meta) => meta.kind === 'payment.reverse' && meta.tabId === tabId.value,
  )) {
    if (op.meta.kind === 'payment.reverse') {
      result[op.meta.paymentId] = pendingLabel(op.action, connection.online)
    }
  }
  return result
})
const pendingDiscount = computed(
  () =>
    pendingOperations(
      connection.pending,
      (meta) => meta.kind === 'tab.discount' && meta.tabId === tabId.value,
    )[0] ?? null,
)

/**
 * Quanto falta descontando os pagamentos ainda na fila: é o valor sugerido no teclado. O saldo
 * em destaque continua o confirmado pela API.
 */
const padBalance = computed(() => {
  const balance = tab.value?.balanceCents ?? 0
  return applyDraftPayments(
    balance,
    pendingPayments.value.map((item) => ({ method: item.meta.method, cents: item.meta.cents })),
  ).remainingCents
})
const pendingSum = computed(() => (tab.value?.balanceCents ?? 0) - padBalance.value)

const canReceive = computed(
  () =>
    tab.value?.status === 'closing' &&
    tab.value.totalCents > 0 &&
    !(cash.loaded.value && cash.openRegisters.value.length === 0),
)
const issue = computed(() =>
  method.value ? paymentIssue(method.value, cents.value, padBalance.value) : null,
)
const blocked = computed(
  () => !canReceive.value || !method.value || !!issue.value || cash.needsChoice.value,
)

function resetPad() {
  method.value = null
  cents.value = 0
}

function applyTab(next: Tab | undefined) {
  if (!next || !tab.value || next.id !== tab.value.id) return
  if (next.version >= tab.value.version) tab.value = next
  counter.board?.apply(next)
}

async function confirmPayment() {
  const current = tab.value
  const chosen = method.value
  if (!current || !chosen || blocked.value || sending.value) return
  sending.value = true
  payError.value = ''
  notice.value = ''
  const value = cents.value
  const changeCents = chosen === 'cash' ? cashChange(value, padBalance.value).changeCents : 0
  try {
    const { idempotencyKey, settled } = await operations.submit({
      path: `/api/v1/tabs/${current.id}/payments`,
      body: toPaymentBody(chosen, value, cash.selectedId.value),
      label: `${PAYMENT_METHOD_LABELS[chosen]} de ${formatCents(value)} · comanda ${current.number} · ${current.customerName}`,
      meta: {
        kind: 'tab.payment',
        tabId: current.id,
        tabNumber: current.number,
        method: chosen,
        cents: value,
        changeCents,
        cashRegisterId: cash.selectedId.value,
      },
    })
    resetPad()
    // Troco é dinheiro na mão: aparece já, marcado como não confirmado até a resposta.
    lastChange.value = chosen === 'cash' ? { cents: changeCents, confirmed: false } : null
    const outcome = await waitOutcome(idempotencyKey, settled)
    if (outcome && !outcome.ok) {
      lastChange.value = null
      payError.value = paymentFailureText(outcome.error.code, outcome.error.message)
    }
  } finally {
    sending.value = false
  }
}

function paymentFailureText(code: string, message: string): string {
  if (code === 'CASH_REGISTER_REQUIRED') {
    void cash.load()
    return 'Há mais de um caixa aberto: escolha o caixa e confirme de novo.'
  }
  if (code === 'NO_CASH_REGISTER_OPEN') {
    void cash.load()
    return 'Abra um caixa para receber.'
  }
  if (code === 'PAYMENT_EXCEEDS_BALANCE' || code === 'TAB_NOTHING_TO_PAY') reloadSoon()
  return message
}

// Resposta da API às ações deste aparelho nesta comanda.
operations.onSettled((meta, outcome) => {
  if (!('tabId' in meta) || meta.tabId !== tabId.value) return
  if (outcome.ok && (meta.kind === 'tab.payment' || meta.kind === 'payment.reverse')) {
    const result = outcome.body as PaymentResult | undefined
    applyTab(result?.tab)
    if (meta.kind === 'tab.payment' && result?.payment.method === 'cash') {
      lastChange.value = { cents: result.payment.changeCents ?? 0, confirmed: true }
    }
  } else if (outcome.ok && meta.kind === 'tab.discount') {
    applyTab(outcome.body as Tab | undefined)
  }
  reloadSoon()
})

// Recusas que chegaram depois de sair da fila: explicadas aqui, e não só na faixa do topo.
useOperationFailures((meta, failure, action) => {
  if (!('tabId' in meta) || meta.tabId !== tabId.value) return false
  const key = action.idempotencyKey
  if (explainedInline.has(key) || waitingKey.value === key) return true
  if (meta.kind === 'tab.payment') {
    lastChange.value = null
    notice.value = `${PAYMENT_METHOD_LABELS[meta.method]} de ${formatCents(meta.cents)} não foi registrado: ${paymentFailureText(failure.code, failure.message)}`
    return true
  }
  if (meta.kind === 'payment.reverse') {
    notice.value = `Estorno não registrado: ${failure.message}`
    reloadSoon()
    return true
  }
  if (meta.kind === 'tab.discount') {
    notice.value = `Desconto não aplicado: ${failure.message}`
    reloadSoon()
    return true
  }
  return false
})

// Pedir a conta daqui (RN-05.07: só se recebe em `closing`).
function requestBill(current: Tab) {
  void operations.submit({
    path: `/api/v1/tabs/${current.id}/request-bill`,
    body: {},
    label: `Pedir a conta da comanda ${current.number} · ${current.customerName}`,
    meta: { kind: 'tab.request_bill', tabId: current.id, tabNumber: current.number },
  })
}
const requestingBill = computed(() =>
  pendingOperations(
    connection.pending,
    (meta) => meta.kind === 'tab.request_bill' && meta.tabId === tabId.value,
  ).some(() => true),
)

// Estorno (RN-05.13 a 05.15)
const reversing = ref<Payment | null>(null)
const reverseOpen = computed({
  get: () => reversing.value !== null,
  set: (open: boolean) => {
    if (!open) reversing.value = null
  },
})
const reverseReason = ref('')
const reverseTouched = ref(false)
const reverseError = computed(() =>
  reverseTouched.value && !reverseReason.value.trim() ? 'Diga o motivo do estorno.' : '',
)

function startReverse(payment: Payment) {
  reversing.value = payment
  reverseReason.value = ''
  reverseTouched.value = false
}

function confirmReverse() {
  reverseTouched.value = true
  const payment = reversing.value
  const current = tab.value
  if (!payment || !current || reverseError.value) return
  void operations.submit({
    path: `/api/v1/payments/${payment.id}/reverse`,
    body: { reason: reverseReason.value.trim() },
    label: `Estorno de ${formatCents(payment.amountCents)} no ${PAYMENT_METHOD_LABELS[payment.method]} · comanda ${current.number}`,
    meta: {
      kind: 'payment.reverse',
      paymentId: payment.id,
      tabId: current.id,
      tabNumber: current.number,
    },
  })
  lastChange.value = null
  reversing.value = null
}

// Desconto (RN-05.01 a 05.03)
/** "Dar desconto" da comanda abre esta tela já com o desconto (`?desconto=1`). */
const discountOpen = ref(route.query.desconto === '1')
const discountBusy = ref(false)
const discountError = ref('')

async function submitDiscount(
  current: Tab,
  input:
    | { remove: false; type: DiscountType; value: number; reason: string; description: string }
    | { remove: true; reason: string },
) {
  discountBusy.value = true
  discountError.value = ''
  try {
    const { idempotencyKey, settled } = await operations.submit({
      method: input.remove ? 'DELETE' : 'PUT',
      path: `/api/v1/tabs/${current.id}/discount`,
      body: input.remove
        ? { reason: input.reason }
        : { type: input.type, value: input.value, reason: input.reason },
      label: input.remove
        ? `Remover desconto da comanda ${current.number}`
        : `Desconto de ${input.description} na comanda ${current.number}`,
      meta: {
        kind: 'tab.discount',
        tabId: current.id,
        tabNumber: current.number,
        remove: input.remove,
        description: input.remove ? '' : input.description,
      },
    })
    const outcome = await waitOutcome(idempotencyKey, settled)
    if (outcome && !outcome.ok) {
      discountError.value = outcome.error.message
      return
    }
    discountOpen.value = false
  } finally {
    discountBusy.value = false
  }
}

const paid = computed(() => tab.value?.status === 'paid')
</script>

<template>
  <div>
    <OperationShell
      :title="tab ? `Receber · ${tab.number} · ${tab.customerName}` : `Receber · comanda ${number}`"
      :unit-name="place?.unit.name"
      :back="`/balcao/comandas/${number}`"
      back-label="Voltar à comanda"
      wide
    >
      <AppAlert v-if="!place">
        Escolha uma estação de balcão liberada para você em "Trocar de estação".
      </AppAlert>
      <template v-else-if="counter.shiftLoaded && !counter.shift">
        <NoShiftNotice :unit-id="place.unit.id" />
      </template>
      <template v-else>
        <AppAlert v-if="error && !(tab && !connection.online)" tone="error">{{ error }}</AppAlert>
        <AppAlert v-if="notFound" tone="error">
          A comanda {{ number }} não existe neste turno.
          <NuxtLink to="/balcao" class="font-bold underline">Voltar ao varal</NuxtLink>
        </AppAlert>
        <p v-else-if="!tab" class="text-text-muted">Carregando comanda…</p>

        <div
          v-if="tab"
          class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          data-testid="receive-screen"
        >
          <section class="flex min-w-0 flex-col gap-4" aria-label="Conta">
            <div class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4">
              <div class="flex items-center gap-2">
                <h2 class="flex-1 text-lg">Conta</h2>
                <StageChip
                  :status="paid ? 'ready' : tab.status === 'closing' ? 'closing' : 'preparing'"
                  :label="TAB_STATUS_LABELS[tab.status]"
                />
              </div>
              <dl class="grid grid-cols-2 gap-1">
                <dt class="text-text-muted">Subtotal</dt>
                <dd class="text-right tabular-nums">{{ formatCents(tab.subtotalCents) }}</dd>
                <dt class="text-text-muted">
                  Desconto
                  <template v-if="tab.discountType">
                    ({{ discountLabel(tab.discountType, tab.discountValue) }})
                  </template>
                </dt>
                <dd class="text-right tabular-nums" data-testid="receive-discount">
                  {{ tab.discountCents > 0 ? `- ${formatCents(tab.discountCents)}` : '—' }}
                </dd>
                <dt class="font-bold">Total</dt>
                <dd class="text-right font-bold tabular-nums" data-testid="receive-total">
                  {{ formatCents(tab.totalCents) }}
                </dd>
                <dt class="text-text-muted">Pago</dt>
                <dd class="text-right tabular-nums" data-testid="receive-paid">
                  {{ formatCents(tab.paidCents) }}
                </dd>
              </dl>
              <div
                class="flex items-baseline justify-between gap-2 rounded-card bg-primary-soft px-3 py-2 text-primary-deep"
              >
                <span class="text-lg font-bold">Saldo</span>
                <span
                  class="font-display text-[2.5rem] leading-none font-extrabold tabular-nums"
                  data-testid="receive-balance"
                  >{{ formatCents(tab.balanceCents) }}</span
                >
              </div>
              <p v-if="pendingSum > 0" class="text-sm font-bold" data-testid="pending-sum">
                {{ formatCents(pendingSum) }} na fila, ainda não confirmados: o saldo só muda quando
                a API registrar.
              </p>
              <StageChip
                v-if="pendingDiscount"
                status="pending"
                :label="`Desconto: ${pendingLabel(pendingDiscount.action, connection.online)}`"
              />
              <AppButton
                v-if="tab.status === 'open' || tab.status === 'closing'"
                variant="secondary"
                :disabled="!!pendingDiscount"
                data-testid="open-discount"
                @click="((discountError = ''), (discountOpen = true))"
              >
                <AppIcon name="percent" />
                {{ tab.discountCents > 0 ? 'Alterar desconto' : 'Dar desconto' }}
              </AppButton>
            </div>

            <AppAlert v-if="notice" tone="error">
              <p>{{ notice }}</p>
              <button type="button" class="min-h-12 font-bold underline" @click="notice = ''">
                Entendi
              </button>
            </AppAlert>

            <AppAlert v-if="paid" tone="success">
              <p class="font-bold" data-testid="tab-paid">Comanda paga.</p>
              <p>Ela saiu do varal.</p>
            </AppAlert>

            <div
              v-if="lastChange && lastChange.cents > 0"
              class="flex flex-col gap-1 rounded-card border-2 border-primary bg-surface p-4"
              role="status"
            >
              <span class="text-lg font-bold">Troco</span>
              <span
                class="font-display text-[3rem] leading-none font-extrabold text-primary-deep tabular-nums"
                data-testid="last-change"
                >{{ formatCents(lastChange.cents) }}</span
              >
              <span v-if="!lastChange.confirmed" class="text-sm text-text-muted">
                Calculado no aparelho; o pagamento ainda não foi confirmado.
              </span>
            </div>

            <section class="flex flex-col gap-2" aria-labelledby="payments-title">
              <h2 id="payments-title" class="text-lg">Pagamentos</h2>
              <ul class="flex flex-col gap-2">
                <li
                  v-for="payment in payments"
                  :key="payment.id"
                  class="flex flex-col gap-1 rounded-card border-2 border-border bg-surface px-3 py-2"
                  data-testid="payment-row"
                >
                  <div class="flex items-center gap-2">
                    <span
                      class="flex-1 font-bold"
                      :class="isActivePayment(payment) ? '' : 'text-text-muted line-through'"
                      >{{ PAYMENT_METHOD_LABELS[payment.method] }}
                      <span class="font-normal text-text-muted"
                        >· {{ formatTime(payment.createdAt) }}</span
                      ></span
                    >
                    <span
                      class="tabular-nums"
                      :class="
                        isActivePayment(payment) ? 'font-bold' : 'text-text-muted line-through'
                      "
                      >{{ formatCents(payment.amountCents) }}</span
                    >
                  </div>
                  <p v-if="payment.method === 'cash' && payment.tenderedCents" class="text-sm">
                    Entregue {{ formatCents(payment.tenderedCents) }} · troco
                    {{ formatCents(payment.changeCents ?? 0) }}
                  </p>
                  <StageChip
                    v-if="!isActivePayment(payment)"
                    status="canceled"
                    :label="`Estornado${payment.reversalReason ? `: ${payment.reversalReason}` : ''}`"
                  />
                  <StageChip
                    v-else-if="pendingReversals[payment.id]"
                    status="pending"
                    :label="`Estorno: ${pendingReversals[payment.id]}`"
                  />
                  <button
                    v-else
                    type="button"
                    class="min-h-12 self-start rounded-button font-bold text-status-late-text underline-offset-4 hover:underline"
                    data-testid="reverse-payment"
                    @click="startReverse(payment)"
                  >
                    Estornar
                  </button>
                </li>
                <li
                  v-for="pending in pendingPayments"
                  :key="pending.key"
                  class="flex flex-col gap-1 rounded-card border-2 border-dashed border-border-strong bg-surface-muted px-3 py-2"
                  data-testid="pending-payment"
                >
                  <div class="flex items-center gap-2">
                    <span class="flex-1 font-bold">{{
                      PAYMENT_METHOD_LABELS[pending.meta.method]
                    }}</span>
                    <span class="tabular-nums">{{ formatCents(pending.meta.cents) }}</span>
                  </div>
                  <StageChip status="pending" :label="pending.label" />
                  <p class="text-sm text-text-muted">
                    Ainda não confirmado: a comanda só fica paga quando a API registrar.
                  </p>
                </li>
              </ul>
              <p
                v-if="payments.length === 0 && pendingPayments.length === 0"
                class="text-text-muted"
              >
                Nenhum pagamento ainda.
              </p>
            </section>
          </section>

          <section class="flex min-w-0 flex-col gap-4" aria-label="Receber pagamento">
            <template v-if="tab.status === 'open'">
              <AppAlert>
                A comanda ainda está aberta. Peça a conta para receber: depois disso ela não aceita
                pedidos novos.
              </AppAlert>
              <AppButton
                variant="secondary"
                :disabled="requestingBill"
                data-testid="receive-request-bill"
                @click="requestBill(tab)"
              >
                <AppIcon name="receipt" />
                {{ requestingBill ? 'Pedindo a conta…' : 'Pedir a conta' }}
              </AppButton>
            </template>
            <AppAlert v-else-if="tab.status === 'closing' && tab.totalCents === 0" tone="error">
              Comanda sem valor (tudo cancelado) não recebe pagamento: cancele a comanda.
              <NuxtLink :to="`/balcao/comandas/${tab.number}`" class="font-bold underline">
                Ver comanda
              </NuxtLink>
            </AppAlert>
            <template v-else-if="tab.status === 'closing'">
              <RegisterPicker
                :registers="cash.openRegisters.value"
                :selected-id="cash.selectedId.value"
                :loaded="cash.loaded.value"
                :can-open="canOpenRegister"
                :unit-id="unitId"
                @choose="cash.choose"
              />
              <PaymentPad
                v-model:method="method"
                v-model:cents="cents"
                :balance-cents="padBalance"
                :disabled="!canReceive"
              />
              <AppAlert v-if="payError" tone="error">
                <p data-testid="pay-error">{{ payError }}</p>
              </AppAlert>
              <AppButton
                variant="secondary"
                disabled
                title="O fiado chega com o módulo de fiado."
                data-testid="hang-on-credit"
              >
                Pendurar · disponível em breve
              </AppButton>
            </template>
          </section>
        </div>
      </template>

      <template v-if="tab" #footer>
        <AppButton v-if="paid" to="/balcao" data-testid="back-to-board">
          <AppIcon name="arrow-left" />
          Voltar ao varal
        </AppButton>
        <AppButton
          v-else-if="tab.status === 'closing'"
          :disabled="blocked"
          :loading="sending"
          data-testid="confirm-payment"
          @click="confirmPayment"
        >
          <template v-if="method">{{ confirmPaymentLabel(method, cents) }}</template>
          <template v-else>Escolha a forma de pagamento</template>
        </AppButton>
        <AppButton v-else :to="`/balcao/comandas/${tab.number}`" variant="secondary">
          Voltar à comanda
        </AppButton>
      </template>
    </OperationShell>

    <AppDialog v-model:open="reverseOpen" title="Estornar pagamento">
      <form
        v-if="reversing"
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="confirmReverse"
      >
        <p>
          Estornar {{ formatCents(reversing.amountCents) }} no
          {{ PAYMENT_METHOD_LABELS[reversing.method] }}? O pagamento continua registrado, sai do
          saldo e do caixa <template v-if="paid">, e a comanda volta para "Fechando"</template>.
        </p>
        <AppTextField
          v-model="reverseReason"
          label="Motivo do estorno"
          :maxlength="REASON_MAX"
          :error="reverseError"
          autocomplete="off"
        />
        <AppButton type="submit" data-testid="confirm-reverse">Estornar pagamento</AppButton>
      </form>
    </AppDialog>

    <AppDialog v-model:open="discountOpen" title="Desconto">
      <div v-if="tab" class="flex flex-col gap-4">
        <DiscountForm
          :subtotal-cents="tab.subtotalCents"
          :paid-cents="tab.paidCents"
          :current="
            tab.discountType && tab.discountValue !== null
              ? { type: tab.discountType, value: tab.discountValue, reason: tab.discountReason }
              : null
          "
          :busy="discountBusy"
          @apply="submitDiscount(tab, { remove: false, ...$event })"
          @remove="submitDiscount(tab, { remove: true, reason: $event })"
        />
        <AppAlert v-if="discountError" tone="error">{{ discountError }}</AppAlert>
      </div>
    </AppDialog>
  </div>
</template>
