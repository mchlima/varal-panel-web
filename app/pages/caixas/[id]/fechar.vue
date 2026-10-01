<script setup lang="ts">
import OperationShell from '~/components/OperationShell.vue'
import PanelShell from '~/components/PanelShell.vue'
import { formatCents, parseReais } from '~/lib/money'
import {
  CLOSING_NOTE_MAX,
  COUNT_HINTS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  closingRows,
  countsOf,
  expectedSplit,
  splitLabel,
  differenceLabel,
  hasDifference,
  type CashRegisterDetail,
  type PaymentMethod,
} from '~/lib/payment'
import { explainError, type ExplainedError } from '~/lib/setup'

/**
 * Fechar caixa (`/caixas/{id}/fechar`, spec 05, RN-05.20, CA-05.07): para cada forma, o
 * esperado, o valor conferido e a diferença (informado − esperado) calculada ao vivo; havendo
 * diferença, a observação é obrigatória (`CLOSING_NOTE_REQUIRED`). Confirmação final antes de
 * enviar: caixa fechado não reabre (RN-05.21). Feito com conexão, com `Idempotency-Key` e a
 * `version` do caixa (um pagamento que chega no meio muda o esperado e a tela avisa).
 */
const route = useRoute()
const session = useSessionStore()
const { $api } = useNuxtApp()
const id = computed(() => String(route.params.id))

useHead({ title: 'Fechar caixa · Varal' })

const register = ref<CashRegisterDetail | null>(null)
const loadError = ref('')
const expectedChanged = ref(false)

async function load() {
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/cash-registers/{id}', {
      params: { path: { id: id.value } },
    })
    if (!data) {
      loadError.value = explainError(error).message
      return
    }
    register.value = data
  } catch (error) {
    loadError.value = explainError(error).message
  }
}
onMounted(load)
useRealtimeResync(load)
useRealtimeEvent('cash_register.updated', (event) => {
  const current = register.value
  if (!current || event.data.id !== current.id || event.data.version <= current.version) return
  // Pagamento, estorno ou movimento novo: o esperado muda na hora.
  const changed = PAYMENT_METHODS.some(
    (method) =>
      event.data.expected.find((entry) => entry.method === method)?.expectedCents !==
      current.expected.find((entry) => entry.method === method)?.expectedCents,
  )
  register.value = { ...current, ...event.data }
  if (changed) expectedChanged.value = true
})
useRealtimeEvent('cash_register.closed', (event) => {
  if (register.value && event.data.id === register.value.id) {
    register.value = { ...register.value, ...event.data }
  }
})

const inputs = reactive<Record<PaymentMethod, string>>({
  cash: '',
  pix: '',
  credit_card: '',
  debit_card: '',
})
const note = ref('')
const touched = ref(false)
const confirming = ref(false)

const informed = computed(() => {
  const result: Partial<Record<PaymentMethod, number | null>> = {}
  for (const method of PAYMENT_METHODS) {
    result[method] = inputs[method].trim() ? parseReais(inputs[method]) : null
  }
  return result
})
const rows = computed(() => (register.value ? closingRows(register.value, informed.value) : []))
const differs = computed(() => hasDifference(rows.value))
/** Vendas do turno e quitações de fiado separadas no esperado de cada forma (RN-05.22). */
const splits = computed(() => {
  const current = register.value
  return Object.fromEntries(
    PAYMENT_METHODS.map((method) => [
      method,
      current ? splitLabel(expectedSplit(current, method)) : '',
    ]),
  ) as Record<PaymentMethod, string>
})

function fieldError(method: PaymentMethod): string {
  if (!touched.value) return ''
  if (!inputs[method].trim()) return 'Informe o valor conferido (pode ser 0).'
  return informed.value[method] === null ? 'Valor inválido.' : ''
}
const noteError = computed(() => {
  if (!touched.value) return ''
  if (differs.value && !note.value.trim()) return 'Há diferença: explique na observação.'
  return ''
})
const valid = computed(
  () => PAYMENT_METHODS.every((method) => informed.value[method] != null) && !noteError.value,
)

function review() {
  touched.value = true
  if (differs.value && !note.value.trim()) return
  if (!PAYMENT_METHODS.every((method) => informed.value[method] != null)) return
  confirming.value = true
}

const action = useApiAction()
const key = useIdempotencyKey()
const closeError = ref<ExplainedError | null>(null)

async function close() {
  const current = register.value
  if (!current || !valid.value) return
  closeError.value = null
  const body = {
    counts: PAYMENT_METHODS.map((method) => ({
      method,
      informedCents: informed.value[method] ?? 0,
    })),
    ...(note.value.trim() ? { note: note.value.trim() } : {}),
    version: current.version,
  }
  const result = await action.run(() =>
    $api.POST('/api/v1/cash-registers/{id}/close', {
      params: { path: { id: current.id }, header: { 'Idempotency-Key': key.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    key.reset()
    if (result.data) register.value = { ...current, ...result.data }
    confirming.value = false
    return
  }
  closeError.value = action.error.value
  confirming.value = false
  const code = action.error.value?.code
  if (code === 'CLOSING_NOTE_REQUIRED') {
    // A API devolve a prévia das diferenças: a tela mostra com a observação obrigatória.
    const preview = countsOf(action.error.value?.details)
    const current = register.value
    if (preview.length && current) {
      register.value = {
        ...current,
        expected: preview.map((count) => {
          const before = current.expected.find((entry) => entry.method === count.method)
          return {
            method: count.method,
            expectedCents: count.expectedCents,
            salesCents: before?.salesCents ?? 0,
            creditSettlementsCents:
              count.creditSettlementsCents ?? before?.creditSettlementsCents ?? 0,
          }
        }),
      }
    }
  } else if (code === 'VERSION_CONFLICT' || code === 'CASH_REGISTER_CLOSED') {
    expectedChanged.value = code === 'VERSION_CONFLICT'
    await load()
  }
}

const canOperate = computed(() => {
  const unitId = register.value?.unitId
  if (session.isOwner) return true
  return session.me?.units.some((unit) => unit.id === unitId && unit.canOperateCash) === true
})
const isOwner = computed(() => session.isOwner)
const closed = computed(() => register.value?.status === 'closed')
const back = computed(() =>
  register.value ? `/caixas?unidade=${register.value.unitId}` : '/caixas',
)
</script>

<template>
  <component
    :is="isOwner ? PanelShell : OperationShell"
    v-bind="
      isOwner
        ? {}
        : {
            title: register ? `Fechar ${register.name}` : 'Fechar caixa',
            back,
            backLabel: 'Voltar aos caixas',
          }
    "
  >
    <div v-if="isOwner" class="flex flex-col gap-1">
      <NuxtLink
        :to="back"
        class="inline-flex min-h-12 items-center gap-1.5 font-bold text-primary-deep"
      >
        <AppIcon name="arrow-left" />
        Caixas
      </NuxtLink>
      <h1 class="text-2xl">{{ register ? `Fechar ${register.name}` : 'Fechar caixa' }}</h1>
    </div>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!register" class="text-text-muted">Carregando…</p>
    <AppAlert v-else-if="!canOperate" tone="error">
      Só o dono e quem opera o caixa fecham caixa.
    </AppAlert>

    <!-- Fechado: a conferência gravada (CA-05.07) -->
    <template v-else-if="closed">
      <AppAlert tone="success">
        <p class="font-bold" data-testid="register-closed">{{ register.name }} fechado.</p>
        <p>Caixa fechado não recebe pagamentos nem movimentos e não pode ser reaberto.</p>
      </AppAlert>
      <ul class="flex flex-col gap-2">
        <li
          v-for="count in register.counts"
          :key="count.method"
          class="flex flex-col gap-1 rounded-card border-2 border-border bg-surface p-3"
        >
          <div class="flex items-center gap-2">
            <span class="flex-1 font-bold">{{ PAYMENT_METHOD_LABELS[count.method] }}</span>
            <span class="tabular-nums">{{ formatCents(count.informedCents) }}</span>
          </div>
          <p v-if="count.creditSettlementsCents > 0" class="text-sm text-text-muted tabular-nums">
            Inclui {{ formatCents(count.creditSettlementsCents) }} de quitações de fiado
          </p>
          <p class="text-sm text-text-muted tabular-nums">
            Esperado {{ formatCents(count.expectedCents) }} ·
            <span :class="count.differenceCents === 0 ? '' : 'font-bold text-error'">{{
              differenceLabel(count.differenceCents)
            }}</span>
          </p>
        </li>
      </ul>
      <p v-if="register.closingNote">Observação: {{ register.closingNote }}</p>
      <AppButton :to="back" variant="secondary">Voltar aos caixas</AppButton>
    </template>

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="review">
      <p class="text-text-muted">
        Para cada forma, informe o valor conferido: o dinheiro contado na gaveta, o Pix no extrato e
        os cartões pela maquininha.
      </p>
      <AppAlert v-if="expectedChanged">
        <p>O esperado mudou (pagamento ou movimento novo neste caixa). Confira de novo.</p>
        <button type="button" class="min-h-12 font-bold underline" @click="expectedChanged = false">
          Entendi
        </button>
      </AppAlert>

      <ul class="flex flex-col gap-3">
        <li
          v-for="row in rows"
          :key="row.method"
          class="flex flex-col gap-2 rounded-card border-2 border-border bg-surface p-4"
          :data-testid="`count-${row.method}`"
        >
          <div class="flex items-baseline gap-2">
            <h2 class="flex-1 text-lg">{{ PAYMENT_METHOD_LABELS[row.method] }}</h2>
            <span class="text-sm text-text-muted tabular-nums"
              >Esperado
              <strong class="text-text" :data-testid="`count-expected-${row.method}`">{{
                formatCents(row.expectedCents)
              }}</strong></span
            >
          </div>
          <p
            class="-mt-1 text-sm text-text-muted tabular-nums"
            :data-testid="`count-split-${row.method}`"
          >
            {{ splits[row.method] }}
          </p>
          <AppTextField
            v-model="inputs[row.method]"
            :label="`${PAYMENT_METHOD_LABELS[row.method]} conferido`"
            :hint="COUNT_HINTS[row.method]"
            inputmode="decimal"
            prefix="R$"
            :error="fieldError(row.method)"
            autocomplete="off"
          />
          <p
            class="flex min-h-6 items-center gap-1.5 font-bold tabular-nums"
            :class="
              row.differenceCents === null || row.differenceCents === 0 ? 'text-text' : 'text-error'
            "
            role="status"
            :data-testid="`difference-${row.method}`"
          >
            <template v-if="row.differenceCents !== null">
              <AppIcon
                :name="row.differenceCents === 0 ? 'check-circle' : 'alert-circle'"
                :size="16"
              />
              {{ differenceLabel(row.differenceCents) }}
            </template>
          </p>
        </li>
      </ul>

      <label class="flex flex-col gap-1">
        <span class="font-bold">
          Observação {{ differs ? '(obrigatória: há diferença)' : '(opcional)' }}
        </span>
        <textarea
          v-model="note"
          :maxlength="CLOSING_NOTE_MAX"
          rows="3"
          class="w-full rounded-button border-2 bg-surface px-4 py-2"
          :class="noteError ? 'border-error' : 'border-border-strong'"
          :aria-invalid="noteError ? 'true' : undefined"
          data-testid="closing-note"
        />
        <span class="flex min-h-6 items-center text-sm font-bold text-error" role="status">{{
          noteError
        }}</span>
      </label>

      <ErrorAlert :error="closeError" @reload="load" />

      <div
        v-if="confirming"
        role="group"
        aria-label="Confirmar fechamento"
        class="flex flex-col gap-3 rounded-card border-2 border-primary bg-surface p-4"
        data-testid="confirm-close"
      >
        <p class="font-bold">Fechar {{ register.name }}? Depois disso ele não reabre.</p>
        <ul class="flex flex-col gap-1 text-sm tabular-nums">
          <li v-for="row in rows" :key="row.method">
            {{ PAYMENT_METHOD_LABELS[row.method] }}: {{ formatCents(row.informedCents ?? 0) }} ·
            {{ differenceLabel(row.differenceCents ?? 0) }}
          </li>
        </ul>
        <AppButton :loading="action.busy.value" data-testid="confirm-close-register" @click="close">
          Confirmar fechamento
        </AppButton>
        <AppButton variant="ghost" @click="confirming = false">Voltar e corrigir</AppButton>
      </div>
      <AppButton v-else type="submit" data-testid="review-close">
        <AppIcon name="check" />
        Fechar caixa
      </AppButton>
    </form>
  </component>
</template>
