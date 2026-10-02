<script setup lang="ts">
import { formatCents, parseReais } from '~/lib/money'
import { sinceLabel, shortDay } from '~/lib/operation'
import {
  CLOSING_NOTE_MAX,
  COUNT_HINTS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  cashRegisterHint,
  closingRows,
  countsOf,
  differenceLabel,
  expectedSplit,
  hasDifference,
  splitLabel,
  toCloseBody,
  type CashRegister,
  type CashRegisterClosePreview,
  type CashRegisterSession,
  type PaymentMethod,
} from '~/lib/payment'
import { explainError, type ExplainedError } from '~/lib/setup'

/**
 * Fechar caixa (`/caixas/{id}/fechar`, spec 05, seção 5.4): para cada forma, o esperado, o valor
 * conferido e a diferença calculada ao vivo; havendo diferença, a observação é obrigatória
 * (RN-05.20, CA-05.07). Comandas em aberto não impedem fechar: aparecem como pendentes que
 * seguem abertas (RN-05.28, CA-05.11). No último caixa aberto, a confirmação mostra os itens em
 * preparo ("Encerrar o preparo pendente", marcado) e o evento em andamento ("Encerrar também o
 * evento", desmarcado), RN-05.29. Depois de fechar, quem fechou vê só o resumo do próprio
 * fechamento; o relatório do caixa é do dono (RN-07.07).
 */
const route = useRoute()
const { $api } = useNuxtApp()
const session = useSessionStore()
const registerId = computed(() => String(route.params.id))
const { unitId, unit, register, notFound, reload } = useRegisterPlace(registerId)

useHead({ title: () => `Fechar ${register.value?.name ?? 'caixa'} · Varal` })

const preview = ref<CashRegisterClosePreview | null>(null)
const previewError = ref('')
const expectedChanged = ref(false)
/** Abertura fechada nesta tela: o resumo do fechamento (spec 05, seção 8). */
const closedSession = ref<CashRegisterSession | null>(null)

const openSessionId = computed(() =>
  register.value?.session?.status === 'open' ? register.value.session.id : null,
)

async function loadPreview() {
  const id = openSessionId.value
  if (!id || closedSession.value) return
  previewError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/cash-register-sessions/{id}/close-preview', {
      params: { path: { id } },
    })
    if (!data) {
      previewError.value = explainError(error).message
      return
    }
    const before = preview.value?.session
    if (before && before.id === data.session.id && expectedDiffers(before, data.session)) {
      expectedChanged.value = true
    }
    preview.value = data
  } catch (error) {
    previewError.value = explainError(error).message
  }
}

function expectedDiffers(a: CashRegisterSession, b: CashRegisterSession): boolean {
  return PAYMENT_METHODS.some(
    (method) =>
      a.expected.find((entry) => entry.method === method)?.expectedCents !==
      b.expected.find((entry) => entry.method === method)?.expectedCents,
  )
}

watch(openSessionId, () => void loadPreview(), { immediate: true })
useRealtimeResync(loadPreview)
let timer: ReturnType<typeof setTimeout> | null = null
function previewSoon() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void loadPreview(), 300)
}
// Pagamento, estorno ou movimento novo muda o esperado; comanda nova ou paga muda os pendentes.
useRealtimeEvent('cash_register.updated', (event) => {
  if (event.data.id === registerId.value) previewSoon()
})
useRealtimeEvent('tab.updated', (event) => {
  if (event.unitId === unitId.value) previewSoon()
})
useRealtimeEvent('tab.created', (event) => {
  if (event.unitId === unitId.value) previewSoon()
})
onScopeDispose(() => {
  if (timer) clearTimeout(timer)
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
const finishPendingItems = ref(true)
const finishEvent = ref(false)

const informed = computed(() => {
  const result: Partial<Record<PaymentMethod, number | null>> = {}
  for (const method of PAYMENT_METHODS) {
    result[method] = inputs[method].trim() ? parseReais(inputs[method]) : null
  }
  return result
})
const rows = computed(() =>
  preview.value ? closingRows(preview.value.session, informed.value) : [],
)
const differs = computed(() => hasDifference(rows.value))

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
const complete = computed(() => PAYMENT_METHODS.every((method) => informed.value[method] != null))

function review() {
  touched.value = true
  if (!complete.value || noteError.value) return
  confirming.value = true
}

const action = useApiAction()
const key = useIdempotencyKey()
const closeError = ref<ExplainedError | null>(null)

async function close() {
  const current = preview.value
  if (!current || !complete.value || noteError.value) return
  closeError.value = null
  const body = toCloseBody({
    informed: informed.value,
    note: note.value,
    lastOpenRegister: current.lastOpenRegister,
    finishPendingItems: finishPendingItems.value,
    finishEvent: finishEvent.value,
    version: current.session.version,
  })
  const result = await action.run(() =>
    $api.POST('/api/v1/cash-register-sessions/{id}/close', {
      params: {
        path: { id: current.session.id },
        header: { 'Idempotency-Key': key.keyFor(body) },
      },
      body,
    }),
  )
  confirming.value = false
  if (result.ok) {
    key.reset()
    const data = result.data as CashRegister | undefined
    closedSession.value = data?.session ?? { ...current.session, status: 'closed' }
    if (data) useOperationStore().applyRegister(data)
    void reload()
    return
  }
  const error = action.error.value
  closeError.value = error ? { ...error, hint: cashRegisterHint(error.code) ?? error.hint } : null
  if (error?.code === 'CLOSING_NOTE_REQUIRED') {
    // A API devolve a prévia das diferenças: o esperado da tela passa a ser o dela.
    const counts = countsOf(error.details)
    if (counts.length) {
      preview.value = {
        ...current,
        session: {
          ...current.session,
          expected: counts.map((count) => ({
            method: count.method,
            expectedCents: count.expectedCents,
            salesCents:
              current.session.expected.find((entry) => entry.method === count.method)?.salesCents ??
              0,
            creditSettlementsCents: count.creditSettlementsCents,
          })),
        },
      }
    }
  } else if (error?.code === 'VERSION_CONFLICT') {
    expectedChanged.value = true
    await loadPreview()
  } else if (error?.code === 'CASH_REGISTER_CLOSED') {
    await reload()
  }
}

const backToCash = computed(() => (unitId.value ? `/caixas?unidade=${unitId.value}` : '/caixas'))
const summaryRows = computed(() => closedSession.value?.counts ?? [])
</script>

<template>
  <PanelShell>
    <NuxtLink
      :to="backToCash"
      class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Caixas
    </NuxtLink>
    <div class="flex flex-col gap-1">
      <p v-if="unit" class="text-text-muted">{{ unit.name }}</p>
      <h1 class="text-2xl">
        {{
          closedSession
            ? `${register?.name ?? 'Caixa'} fechado`
            : `Fechar ${register?.name ?? 'caixa'}`
        }}
      </h1>
    </div>

    <!-- Resumo do próprio fechamento (spec 05, seção 8; RN-07.07) -->
    <template v-if="closedSession">
      <AppAlert tone="success">
        <p class="font-bold" data-testid="register-closed">Caixa fechado.</p>
        <p>
          Para vender de novo, abra o caixa outra vez: ele começa com um troco novo e os pagamentos
          antigos não mudam.
        </p>
      </AppAlert>
      <section
        class="flex max-w-xl flex-col gap-2"
        aria-label="Resumo do fechamento"
        data-testid="closing-summary"
      >
        <ul class="flex flex-col gap-2">
          <li
            v-for="count in summaryRows"
            :key="count.method"
            class="flex flex-col gap-1 rounded-card border-2 border-border bg-surface p-3"
          >
            <div class="flex items-center gap-2">
              <span class="flex-1 font-bold">{{ PAYMENT_METHOD_LABELS[count.method] }}</span>
              <span class="tabular-nums">{{ formatCents(count.informedCents) }}</span>
            </div>
            <p class="flex items-center gap-1.5 text-sm tabular-nums">
              <span class="text-text-muted">Esperado {{ formatCents(count.expectedCents) }} ·</span>
              <AppIcon
                :name="count.differenceCents === 0 ? 'check-circle' : 'alert-circle'"
                :size="14"
              />
              <span :class="count.differenceCents === 0 ? 'text-text' : 'font-bold text-error'">{{
                differenceLabel(count.differenceCents)
              }}</span>
            </p>
          </li>
        </ul>
        <dl
          class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-card border-2 border-border bg-surface p-3"
        >
          <dt class="text-text-muted">Recebido neste caixa</dt>
          <dd class="text-right font-bold tabular-nums">
            {{ formatCents(closedSession.receivedCents) }}
          </dd>
          <dt class="text-text-muted">Diferença total</dt>
          <dd class="text-right font-bold tabular-nums">
            {{ differenceLabel(closedSession.differenceCents) }}
          </dd>
          <dt class="text-text-muted">Comandas que seguem abertas</dt>
          <dd class="text-right font-bold tabular-nums">
            {{ closedSession.pendingTabsCount ?? 0 }} ·
            {{ formatCents(closedSession.pendingTabsTotalCents ?? 0) }}
          </dd>
        </dl>
        <p v-if="closedSession.closingNote">Observação: {{ closedSession.closingNote }}</p>
      </section>
      <AppButton to="/painel" data-testid="back-home">Voltar ao início</AppButton>
      <AppButton
        v-if="session.isOwner"
        variant="secondary"
        :to="`/painel/relatorios/caixas/${closedSession.id}`"
        data-testid="session-report"
      >
        <AppIcon name="chart" />
        Ver relatório do caixa
      </AppButton>
    </template>

    <AppAlert v-else-if="notFound" tone="error">
      Este caixa não existe ou é de uma unidade em que você não opera caixa.
      <NuxtLink to="/caixas" class="font-bold underline">Ver os caixas</NuxtLink>
    </AppAlert>
    <p v-else-if="!register" class="text-text-muted">Carregando…</p>
    <template v-else-if="!openSessionId">
      <AppAlert data-testid="not-open">
        <p class="font-bold">{{ register.name }} não está aberto.</p>
        <p>Não há nada para fechar. Para vender, abra o caixa.</p>
      </AppAlert>
      <AppButton :to="`/caixas/${register.id}/abrir`">Abrir {{ register.name }}</AppButton>
    </template>
    <AppAlert v-else-if="previewError" tone="error">{{ previewError }}</AppAlert>
    <p v-else-if="!preview" class="text-text-muted">Carregando…</p>

    <form v-else class="flex max-w-xl flex-col gap-4" novalidate @submit.prevent="review">
      <p class="text-text-muted">
        Confira cada forma e digite o valor que você encontrou: o dinheiro contado na gaveta, o Pix
        no extrato e os cartões no total da maquininha. O sistema mostra se bate com o esperado.
      </p>
      <AppAlert v-if="preview.session.openSinceEarlierDay">
        <p class="font-bold">
          {{ register.name }} aberto desde {{ sinceLabel(preview.session.openedAt) }}.
        </p>
      </AppAlert>
      <AppAlert v-if="expectedChanged">
        <p>Entrou pagamento ou movimento neste caixa: o esperado mudou. Confira de novo.</p>
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
            v-if="expectedSplit(preview.session, row.method).creditSettlementsCents > 0"
            class="-mt-1 text-sm text-text-muted tabular-nums"
          >
            {{ splitLabel(expectedSplit(preview.session, row.method)) }}
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

      <!-- RN-05.28: pendentes não impedem fechar -->
      <section
        class="flex flex-col gap-2 rounded-card border-2 border-border bg-surface p-4"
        data-testid="pending-tabs"
      >
        <h2 class="text-lg">Comandas em aberto</h2>
        <p v-if="preview.pendingTabs.length === 0" class="text-text-muted">
          Nenhuma comanda em aberto.
        </p>
        <template v-else>
          <p class="text-text-muted">
            Elas não impedem fechar: continuam abertas, com o mesmo número, para o próximo dia ou
            para outro caixa aberto.
          </p>
          <ul class="flex flex-col divide-y divide-border">
            <li
              v-for="tab in preview.pendingTabs"
              :key="tab.id"
              class="flex items-center gap-3 py-2"
              data-testid="pending-tab"
            >
              <span class="min-w-10 font-display text-xl font-extrabold tabular-nums">{{
                tab.number
              }}</span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-bold">{{ tab.customerName }}</span>
                <span class="text-sm text-text-muted">desde {{ shortDay(tab.businessDate) }}</span>
              </span>
              <span class="font-bold tabular-nums">{{ formatCents(tab.totalCents) }}</span>
            </li>
          </ul>
          <p class="text-right font-bold tabular-nums">
            Total: {{ formatCents(preview.pendingTabsTotalCents) }}
          </p>
        </template>
      </section>

      <!-- RN-05.29: só no último caixa aberto da unidade -->
      <section
        v-if="preview.lastOpenRegister && (preview.itemsInProgress > 0 || preview.eventInProgress)"
        class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
        data-testid="last-register-options"
      >
        <h2 class="text-lg">Último caixa aberto</h2>
        <label v-if="preview.itemsInProgress > 0" class="flex min-h-12 items-start gap-3">
          <input
            v-model="finishPendingItems"
            type="checkbox"
            class="mt-1 size-6 accent-primary"
            data-testid="finish-pending-items"
          />
          <span>
            <span class="font-bold">Encerrar o preparo pendente</span>
            <span class="block text-sm text-text-muted">
              {{
                preview.itemsInProgress === 1
                  ? '1 item ainda está'
                  : `${preview.itemsInProgress} itens ainda estão`
              }}
              em preparo. Marcado, eles vão para a etapa final e a cozinha começa o próximo dia com
              a tela limpa.
            </span>
          </span>
        </label>
        <label v-if="preview.eventInProgress" class="flex min-h-12 items-start gap-3">
          <input
            v-model="finishEvent"
            type="checkbox"
            class="mt-1 size-6 accent-primary"
            data-testid="finish-event"
          />
          <span>
            <span class="font-bold"
              >Encerrar também o evento {{ preview.eventInProgress.contractorName }}</span
            >
            <span class="block text-sm text-text-muted">
              Deixe desmarcado se o evento continua amanhã.
            </span>
          </span>
        </label>
      </section>

      <ErrorAlert :error="closeError" @reload="loadPreview" />

      <div
        v-if="confirming"
        role="group"
        aria-label="Confirmar fechamento"
        class="flex flex-col gap-3 rounded-card border-2 border-primary bg-surface p-4"
        data-testid="confirm-close"
      >
        <p class="font-bold">Fechar {{ register.name }} com estes valores?</p>
        <p class="text-sm">
          Depois de fechado, os valores não mudam mais. Para vender de novo, é só abrir o caixa
          outra vez.
        </p>
        <ul class="flex flex-col gap-1 text-sm tabular-nums">
          <li v-for="row in rows" :key="row.method">
            {{ PAYMENT_METHOD_LABELS[row.method] }}: {{ formatCents(row.informedCents ?? 0) }} ·
            {{ differenceLabel(row.differenceCents ?? 0) }}
          </li>
          <li v-if="preview.pendingTabs.length">
            {{
              preview.pendingTabs.length === 1
                ? '1 comanda segue aberta'
                : `${preview.pendingTabs.length} comandas seguem abertas`
            }}
          </li>
        </ul>
        <AppButton :loading="action.busy.value" data-testid="confirm-close-register" @click="close">
          Confirmar fechamento
        </AppButton>
        <AppButton variant="ghost" @click="confirming = false">Voltar e corrigir</AppButton>
      </div>
      <AppButton v-else type="submit" data-testid="review-close">
        <AppIcon name="check" />
        Fechar {{ register.name }}
      </AppButton>
    </form>
  </PanelShell>
</template>
