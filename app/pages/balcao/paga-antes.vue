<script setup lang="ts">
import { formatCents } from '~/lib/money'
import type { QueueOutcome } from '~/lib/offline-queue'
import { CUSTOMER_NAME_MAX, itemsLabel, rejectionsOf, type Tab } from '~/lib/operation'
import {
  cartIssue,
  cartTotalCents,
  cartUnits,
  lineTotalCents,
  rejectionsByLine,
  toOrderBody,
  unavailableLines,
} from '~/lib/order-builder'
import {
  PAYMENT_METHOD_LABELS,
  addPaymentLabel,
  applyDraftPayments,
  confirmPaymentLabel,
  paymentIssue,
  registersOf,
  toPayFirstBody,
  type DraftPayment,
  type PaymentMethod,
} from '~/lib/payment'
import { payFirstCartKey } from '~/stores/cart'

/**
 * Comanda paga antes (`/balcao/paga-antes`, RN-04.11, RN-05.12): o balcão monta o pedido,
 * recebe e só então envia, numa única operação (`POST /shifts/{id}/tabs/pay-first`). Nenhum
 * item chega à cozinha antes de o pagamento ser registrado (CA-04.10); se a soma não cobre o
 * total, nada é gravado (`PAYMENT_INSUFFICIENT`, CA-05.09). A comanda ainda não existe: o
 * rascunho fica no aparelho (carrinho `pay-first:{turno}`). Sem rede, a operação vai pela fila
 * e aparece no varal como "pagamento ainda não confirmado" até a API responder.
 */
useHead({ title: 'Paga antes · Varal' })

const route = useRoute()
const { place, counter } = useCounterLive()
const cart = useCartStore()
const operations = useOperations()
const connection = useConnectionStore()
const session = useSessionStore()
const unitId = computed(() => place.value?.unit.id ?? null)
const shiftId = computed(() => counter.shift?.id ?? null)
const { menu, categories, availableProduct } = useCounterMenu(unitId)
const cash = useCashRegisters(shiftId, unitId)
const canOpenRegister = computed(() => session.isOwner || place.value?.unit.canOperateCash === true)

const draftKey = computed(() => (shiftId.value ? payFirstCartKey(shiftId.value) : ''))
const draft = computed(() =>
  draftKey.value ? cart.cartOf(draftKey.value) : { lines: [], rejections: {} },
)
const shiftPrices = computed(() => counter.shift?.prices ?? [])
const total = computed(() => cartTotalCents(draft.value.lines))
const units = computed(() => cartUnits(draft.value.lines))
const unavailable = computed(() => new Set(unavailableLines(draft.value.lines, availableProduct)))
const blocking = computed(() => {
  const issue = cartIssue(draft.value.lines)
  if (issue) return issue
  if (unavailable.value.size > 0) return 'Tire do pedido os itens esgotados para cobrar.'
  return null
})

// Nome do cliente: vem da "Nova comanda" (`?nome=`) e fica no rascunho.
const nameInput = ref('')
const nameTouched = ref(false)
const customerName = computed(() => draft.value.customerName ?? '')
watch(
  draftKey,
  (key) => {
    const fromQuery = typeof route.query.nome === 'string' ? route.query.nome.trim() : ''
    if (key && fromQuery && fromQuery.length <= CUSTOMER_NAME_MAX) {
      cart.setCustomer(key, fromQuery)
    }
  },
  { immediate: true },
)
const nameError = computed(() => {
  if (!nameTouched.value) return ''
  const value = nameInput.value.trim()
  if (!value) return 'Diga o nome do cliente.'
  if (value.length > CUSTOMER_NAME_MAX) return `Use até ${CUSTOMER_NAME_MAX} caracteres.`
  return ''
})
function saveName() {
  nameTouched.value = true
  if (nameError.value || !draftKey.value) return
  cart.setCustomer(draftKey.value, nameInput.value.trim().replace(/\s+/g, ' '))
}

// Etapas: montar → (revisar) → receber e enviar.
const step = ref<'order' | 'pay'>('order')
const reviewOpen = ref(false)
const payments = ref<DraftPayment[]>([])
const method = ref<PaymentMethod | null>(null)
const cents = ref(0)
const applied = computed(() => applyDraftPayments(total.value, payments.value))
const remaining = computed(() => applied.value.remainingCents)
const issue = computed(() =>
  method.value ? paymentIssue(method.value, cents.value, remaining.value) : null,
)
/** O pagamento do teclado completa o total: confirmar já envia. */
const completes = computed(() => {
  if (!method.value || issue.value) return false
  return applyDraftPayments(total.value, [
    ...payments.value,
    { method: method.value, cents: cents.value },
  ]).covered
})
/** Troco de todo o dinheiro informado, já com o pagamento do teclado (RN-05.09). */
const changeCents = computed(() => {
  const list =
    method.value && !issue.value
      ? [...payments.value, { method: method.value, cents: cents.value }]
      : payments.value
  return applyDraftPayments(total.value, list).changeCents
})

function goPay() {
  if (blocking.value || units.value === 0) return
  reviewOpen.value = false
  step.value = 'pay'
}

function removePayment(index: number) {
  payments.value = payments.value.filter((_, position) => position !== index)
}

const sending = ref(false)
const sendError = ref('')
const done = ref<{ number: number; changeCents: number } | null>(null)
const explainedInline = new Set<string>()
const waitingKey = ref<string | null>(null)
const { notice: failureNotice } = usePayFirstFailures(
  (key) => explainedInline.has(key) || waitingKey.value === key,
)

/** Com rede a resposta chega rápido; passado isso, segue na fila e a tela volta ao varal. */
const WAIT_FOR_TAB_MS = 2_500

function primaryAction() {
  if (remaining.value === 0 && payments.value.length > 0) {
    void send(payments.value)
    return
  }
  if (!method.value || issue.value) return
  const next = [...payments.value, { method: method.value, cents: cents.value }]
  method.value = null
  cents.value = 0
  if (applyDraftPayments(total.value, next).covered) void send(next)
  else payments.value = next
}

async function send(list: DraftPayment[]) {
  const shift = counter.shift
  const key = draftKey.value
  const name = customerName.value
  if (!shift || !key || !name || sending.value || blocking.value) return
  if (cash.needsChoice.value) {
    sendError.value = 'Escolha o caixa antes de receber.'
    payments.value = list
    return
  }
  sending.value = true
  sendError.value = ''
  const lines = draft.value.lines
  const summary = applyDraftPayments(total.value, list)
  let outcome: QueueOutcome | null = null
  try {
    const { idempotencyKey, settled } = await operations.submit({
      path: `/api/v1/shifts/${shift.id}/tabs/pay-first`,
      body: toPayFirstBody({
        customerName: name,
        items: toOrderBody(lines).items,
        payments: list,
        cashRegisterId: cash.selectedId.value,
      }),
      label: `Paga antes de ${name} (${itemsLabel(lines.length)}, ${formatCents(total.value)})`,
      meta: {
        kind: 'tab.pay_first',
        shiftId: shift.id,
        customerName: name,
        draftKey: key,
        lines,
        payments: list,
        totalCents: total.value,
      },
    })
    // A partir daqui é da fila: o rascunho esvazia e volta se a API recusar.
    cart.clear(key)
    payments.value = []
    waitingKey.value = idempotencyKey
    outcome = connection.online
      ? await Promise.race([
          settled,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_FOR_TAB_MS)),
        ])
      : null
    if (outcome && !outcome.ok) {
      explainedInline.add(idempotencyKey)
      // Nada foi gravado (RN-05.12): o rascunho volta como estava.
      const rejections =
        outcome.error.code === 'ORDER_REJECTED'
          ? rejectionsByLine(lines, rejectionsOf(outcome.error.details))
          : {}
      cart.restore(key, lines, rejections)
      cart.setCustomer(key, name)
      payments.value = outcome.error.code === 'ORDER_REJECTED' ? [] : list
      if (outcome.error.code === 'ORDER_REJECTED') step.value = 'order'
      if (
        outcome.error.code === 'CASH_REGISTER_REQUIRED' ||
        outcome.error.code === 'NO_CASH_REGISTER_OPEN'
      ) {
        void cash.load()
      }
      sendError.value =
        outcome.error.code === 'CASH_REGISTER_REQUIRED' &&
        registersOf(outcome.error.details).length > 1
          ? 'Há mais de um caixa aberto: escolha o caixa e envie de novo.'
          : outcome.error.message
      return
    }
    if (outcome?.ok) {
      const tab = outcome.body as Tab
      done.value = { number: tab.number, changeCents: summary.changeCents }
      step.value = 'order'
      return
    }
    // Sem resposta ainda (sem rede ou rede lenta): aparece no varal como não confirmada.
    await navigateTo('/balcao')
  } finally {
    waitingKey.value = null
    sending.value = false
  }
}

function startAnother() {
  done.value = null
  nameInput.value = ''
  nameTouched.value = false
  step.value = 'order'
}
</script>

<template>
  <div>
    <OperationShell
      :title="customerName ? `Paga antes · ${customerName}` : 'Paga antes'"
      :unit-name="place?.unit.name"
      back="/balcao"
      back-label="Voltar ao varal"
      wide
    >
      <template v-if="step === 'pay' && !done" #actions>
        <button
          type="button"
          class="flex min-h-12 items-center gap-1.5 rounded-button px-2 text-sm font-bold text-primary-deep"
          data-testid="back-to-order"
          @click="step = 'order'"
        >
          <AppIcon name="arrow-left" />
          Pedido
        </button>
      </template>

      <AppAlert v-if="!place">
        Escolha uma estação de balcão liberada para você em "Trocar de estação".
      </AppAlert>
      <template v-else-if="counter.shiftLoaded && !counter.shift">
        <NoShiftNotice :unit-id="place.unit.id" />
      </template>
      <p v-else-if="!counter.shift" class="text-text-muted">Carregando…</p>

      <!-- Pronto: comanda paga e pedido enviado -->
      <template v-else-if="done">
        <AppAlert tone="success">
          <p class="font-bold" data-testid="pay-first-done">
            Comanda {{ done.number }} paga. O pedido foi para a cozinha.
          </p>
        </AppAlert>
        <div
          v-if="done.changeCents > 0"
          class="flex flex-col gap-1 rounded-card border-2 border-primary bg-surface p-4"
        >
          <span class="text-lg font-bold">Troco</span>
          <span
            class="font-display text-[3rem] leading-none font-extrabold text-primary-deep tabular-nums"
            data-testid="pay-first-change"
            >{{ formatCents(done.changeCents) }}</span
          >
        </div>
        <AppButton variant="secondary" :to="`/balcao/comandas/${done.number}`">
          Ver comanda {{ done.number }}
        </AppButton>
        <AppButton variant="secondary" @click="startAnother">Outra paga antes</AppButton>
      </template>

      <!-- Sem nome ainda -->
      <form
        v-else-if="!customerName"
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="saveName"
      >
        <AppTextField
          v-model="nameInput"
          label="Nome do cliente"
          autocomplete="off"
          autocapitalize="words"
          :maxlength="CUSTOMER_NAME_MAX"
          :error="nameError"
          hint="Aparece junto do número: 12 · Dona Marta."
        />
        <AppButton type="submit">Montar pedido</AppButton>
      </form>

      <template v-else>
        <AppAlert v-if="failureNotice" tone="error">{{ failureNotice }}</AppAlert>
        <AppAlert v-if="menu.loadError" tone="error">{{ menu.loadError }}</AppAlert>

        <template v-if="step === 'order'">
          <AppAlert>
            O pedido só vai para a cozinha depois de pago. Monte o pedido e toque em "Cobrar".
          </AppAlert>
          <ProductPicker
            :categories="categories"
            :cart-key="draftKey"
            :shift-prices="shiftPrices"
            :loading="menu.loading"
          />
        </template>

        <div
          v-else
          class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
          data-testid="pay-first-pay"
        >
          <section class="flex min-w-0 flex-col gap-4" aria-label="Pedido e pagamentos">
            <div class="flex flex-col gap-2 rounded-card border-2 border-border bg-surface p-4">
              <h2 class="text-lg">Pedido</h2>
              <ul class="flex flex-col gap-1">
                <li v-for="line in draft.lines" :key="line.key" class="flex gap-2">
                  <span class="font-bold tabular-nums">{{ line.quantity }}×</span>
                  <span class="flex-1">{{ line.productName }}</span>
                  <span class="tabular-nums">{{ formatCents(lineTotalCents(line)) }}</span>
                </li>
              </ul>
              <div class="flex items-baseline justify-between border-t border-border pt-2">
                <span class="font-bold">Total</span>
                <span class="font-bold tabular-nums" data-testid="pay-first-total">{{
                  formatCents(total)
                }}</span>
              </div>
              <div
                class="flex items-baseline justify-between gap-2 rounded-card bg-primary-soft px-3 py-2 text-primary-deep"
              >
                <span class="text-lg font-bold">Falta</span>
                <span
                  class="font-display text-[2.5rem] leading-none font-extrabold tabular-nums"
                  data-testid="pay-first-remaining"
                  >{{ formatCents(remaining) }}</span
                >
              </div>
            </div>

            <section v-if="applied.lines.length" class="flex flex-col gap-2">
              <h2 class="text-lg">Pagamentos (ainda não enviados)</h2>
              <ul class="flex flex-col gap-2">
                <li
                  v-for="(line, index) in applied.lines"
                  :key="index"
                  class="flex items-center gap-2 rounded-card border-2 border-border bg-surface px-3 py-2"
                  data-testid="draft-payment"
                >
                  <span class="flex-1 font-bold">{{ PAYMENT_METHOD_LABELS[line.method] }}</span>
                  <span class="tabular-nums">{{ formatCents(line.appliedCents) }}</span>
                  <button
                    type="button"
                    class="min-h-12 rounded-button px-2 font-bold text-status-late-text"
                    :aria-label="`Tirar ${PAYMENT_METHOD_LABELS[line.method]} de ${formatCents(line.appliedCents)}`"
                    @click="removePayment(index)"
                  >
                    <AppIcon name="x" />
                  </button>
                </li>
              </ul>
            </section>

            <div
              v-if="changeCents > 0"
              class="flex flex-col gap-1 rounded-card border-2 border-primary bg-surface p-4"
            >
              <span class="text-lg font-bold">Troco</span>
              <span
                class="font-display text-[2.5rem] leading-none font-extrabold text-primary-deep tabular-nums"
                data-testid="pay-first-pending-change"
                >{{ formatCents(changeCents) }}</span
              >
            </div>
          </section>

          <section class="flex min-w-0 flex-col gap-4" aria-label="Receber">
            <RegisterPicker
              :registers="cash.openRegisters.value"
              :selected-id="cash.selectedId.value"
              :loaded="cash.loaded.value"
              :can-open="canOpenRegister"
              :unit-id="unitId"
              @choose="cash.choose"
            />
            <PaymentPad
              v-if="remaining > 0"
              v-model:method="method"
              v-model:cents="cents"
              :balance-cents="remaining"
              :disabled="sending"
            />
            <AppAlert v-if="sendError" tone="error">
              <p data-testid="pay-first-error">{{ sendError }}</p>
            </AppAlert>
          </section>
        </div>
      </template>

      <template v-if="counter.shift && customerName && !done" #footer>
        <AppButton
          v-if="step === 'order'"
          :disabled="units === 0"
          data-testid="review-order"
          @click="reviewOpen = true"
        >
          <template v-if="units === 0">Toque nos produtos para montar o pedido</template>
          <template v-else>Cobrar · {{ itemsLabel(units) }} · {{ formatCents(total) }}</template>
        </AppButton>
        <AppButton
          v-else
          :loading="sending"
          :disabled="
            (cash.loaded.value && cash.openRegisters.value.length === 0) ||
            cash.needsChoice.value ||
            (remaining > 0 && (!method || !!issue))
          "
          data-testid="confirm-pay-first"
          @click="primaryAction"
        >
          <template v-if="remaining === 0">Enviar pedido pago</template>
          <template v-else-if="!method">Escolha a forma de pagamento</template>
          <template v-else-if="completes"
            >{{ confirmPaymentLabel(method, cents) }} e enviar</template
          >
          <template v-else>{{ addPaymentLabel(method, cents) }}</template>
        </AppButton>
      </template>
    </OperationShell>

    <AppDialog v-model:open="reviewOpen" title="Revisar pedido">
      <div v-if="draftKey" class="flex flex-col gap-4">
        <p class="text-text-muted">Paga antes · {{ customerName }}</p>
        <CartReview :cart-key="draftKey" :available-product="availableProduct" />
        <AppAlert v-if="blocking && draft.lines.length > 0" tone="error">{{ blocking }}</AppAlert>
        <AppButton :disabled="!!blocking" data-testid="go-pay" @click="goPay">
          <AppIcon name="wallet" />
          Cobrar {{ formatCents(total) }}
        </AppButton>
      </div>
    </AppDialog>
  </div>
</template>
