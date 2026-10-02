<script setup lang="ts">
import OperationShell from '~/components/OperationShell.vue'
import PanelShell from '~/components/PanelShell.vue'
import { formatDateTime } from '~/lib/datetime'
import { formatCents } from '~/lib/money'
import {
  ALL_TAB_STATUSES,
  MODALITY_LABELS,
  SHIFT_TYPE_LABELS,
  TAB_STATUS_LABELS,
  pendingItemsOf,
  type AgreementModality,
  type Shift,
  type ShiftPendingItems,
  type ShiftType,
  type TabSummary,
} from '~/lib/operation'
import {
  buildOpenShift,
  emptyAgreement,
  parsePrices,
  pricesToInput,
  summarizeTabs,
  type ShiftFormErrors,
} from '~/lib/shift'
import { explainError } from '~/lib/setup'

/**
 * Turnos (`/painel/turnos`, spec 04, seção 8.3): abrir turno (tipo, acordo do contratado,
 * tabela de preços; RN-04.04 a RN-04.06), turno atual com resumo, editar preços e fechar com a
 * lista de pendências (RN-04.07, CA-04.09). Para o dono e para quem opera caixa (RN-04.02).
 * Turno é cadastro feito com conexão (`useApiAction`), com `Idempotency-Key` nas escritas.
 */
useHead({ title: 'Turnos · Varal' })

const route = useRoute()
const session = useSessionStore()
const menu = useMenuStore()
const { $api } = useNuxtApp()

/** Unidades em que esta pessoa abre e fecha turno (RN-04.02). */
const units = computed(() =>
  (session.me?.units ?? []).filter((unit) => session.isOwner || unit.canOperateCash),
)
const selectedUnitId = ref<string | null>(
  typeof route.query.unidade === 'string' ? route.query.unidade : null,
)
const unit = computed(
  () => units.value.find((item) => item.id === selectedUnitId.value) ?? units.value[0] ?? null,
)

const shift = ref<Shift | null>(null)
const tabs = ref<TabSummary[]>([])
const loaded = ref(false)
const loadError = ref('')
const closedMessage = ref('')
/** Turno que acabou de ser fechado nesta tela: o dono pode abrir o relatório dele (spec 07). */
const closedShiftId = ref<string | null>(null)
const summary = computed(() => summarizeTabs(tabs.value))
/** Caixas abertos do turno: o turno só fecha com todos fechados (RN-04.07). */
const shiftId = computed(() => shift.value?.id ?? null)
const unitIdRef = computed(() => unit.value?.id ?? null)
const cash = useCashRegisters(shiftId, unitIdRef)
const openRegisters = computed(() => cash.openRegisters.value.length)
const activeCategories = computed(() =>
  menu.categories
    .filter((category) => category.active)
    .map((category) => ({
      ...category,
      products: category.products.filter((product) => product.active),
    }))
    .filter((category) => category.products.length > 0),
)

async function load() {
  const id = unit.value?.id
  if (!id) return
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/units/{id}/shifts/current', {
      params: { path: { id } },
    })
    if (!data) {
      loadError.value = explainError(error).message
      return
    }
    shift.value = data.shift
    if (data.shift) {
      const result = await $api.GET('/api/v1/shifts/{id}/tabs', {
        params: { path: { id: data.shift.id }, query: { status: ALL_TAB_STATUSES.join(',') } },
      })
      tabs.value = result.data?.data ?? []
    } else {
      tabs.value = []
    }
    loaded.value = true
  } catch (error) {
    loadError.value = explainError(error).message
  }
}

watch(
  () => unit.value?.id,
  (id) => {
    if (!id) return
    loaded.value = false
    void load()
    void menu.load(id)
  },
  { immediate: true },
)
useRealtimeResync(load)

let timer: ReturnType<typeof setTimeout> | null = null
function reloadSoon() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void load(), 400)
}
onScopeDispose(() => {
  if (timer) clearTimeout(timer)
})
for (const event of [
  'shift.opened',
  'shift.updated',
  'shift.closed',
  'tab.created',
  'tab.updated',
] as const) {
  useRealtimeEvent(event, (payload) => {
    if (payload.unitId === unit.value?.id) reloadSoon()
  })
}

// Abrir turno
const openAction = useApiAction()
const openKey = useIdempotencyKey()
const type = ref<ShiftType>('direct_sale')
const agreement = reactive(emptyAgreement())
const priceInput = ref<Record<string, string>>({})
const formErrors = ref<ShiftFormErrors>({})
const modalityOptions = (Object.keys(MODALITY_LABELS) as AgreementModality[]).map((value) => ({
  value,
  label: MODALITY_LABELS[value],
}))

async function openShift() {
  const id = unit.value?.id
  if (!id) return
  closedMessage.value = ''
  closedShiftId.value = null
  const { body, errors } = buildOpenShift(type.value, agreement, priceInput.value)
  formErrors.value = errors
  if (!body) return
  const result = await openAction.run(() =>
    $api.POST('/api/v1/units/{id}/shifts', {
      params: { path: { id }, header: { 'Idempotency-Key': openKey.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    openKey.reset()
    priceInput.value = {}
    Object.assign(agreement, emptyAgreement())
    type.value = 'direct_sale'
    await load()
  } else if (openAction.error.value?.code === 'SHIFT_ALREADY_OPEN') {
    await load()
  }
}

// Editar preços
const editingPrices = ref(false)
const pricesAction = useApiAction()
const pricesKey = useIdempotencyKey()
const editInput = ref<Record<string, string>>({})
const editErrors = ref<Record<string, string>>({})

function startEditPrices() {
  editInput.value = pricesToInput(shift.value?.prices ?? [])
  editErrors.value = {}
  pricesAction.clear()
  editingPrices.value = true
}

async function savePrices() {
  const current = shift.value
  if (!current) return
  const { prices, errors } = parsePrices(editInput.value)
  editErrors.value = errors
  if (Object.keys(errors).length) return
  const body = { prices, version: current.version }
  const result = await pricesAction.run(() =>
    $api.PUT('/api/v1/shifts/{id}/prices', {
      params: { path: { id: current.id }, header: { 'Idempotency-Key': pricesKey.keyFor(body) } },
      body,
    }),
  )
  if (result.ok) {
    pricesKey.reset()
    editingPrices.value = false
    await load()
  }
}

// Fechar turno
const closeAction = useApiAction()
const closeKey = useIdempotencyKey()
const pending = ref<ShiftPendingItems | null>(null)

async function closeShift() {
  const current = shift.value
  if (!current) return
  pending.value = null
  const result = await closeAction.run(() =>
    $api.POST('/api/v1/shifts/{id}/close', {
      params: {
        path: { id: current.id },
        header: { 'Idempotency-Key': closeKey.keyFor(current.id) },
      },
    }),
  )
  if (result.ok) {
    closeKey.reset()
    closedShiftId.value = current.id
    closedMessage.value =
      'Turno fechado. Os itens que ainda estavam em preparo foram levados à etapa final.'
    await load()
    return
  }
  closeKey.reset()
  const error = closeAction.error.value
  if (error?.code === 'SHIFT_HAS_PENDING_ITEMS') pending.value = pendingItemsOf(error.details)
}

const isOwner = computed(() => session.isOwner)
const shiftWho = computed(() => {
  const actor = shift.value?.openedBy
  if (!actor) return ''
  if (actor.type === 'owner') return 'pelo dono'
  return 'por um colaborador'
})
</script>

<template>
  <component
    :is="isOwner ? PanelShell : OperationShell"
    v-bind="
      isOwner
        ? {}
        : { title: 'Turno', unitName: unit?.name, back: '/balcao', backLabel: 'Voltar ao balcão' }
    "
  >
    <div v-if="isOwner" class="flex flex-col gap-1">
      <h1 class="text-2xl">Turno</h1>
      <p class="text-text-muted">Abrir, acompanhar e fechar o turno da barraca.</p>
    </div>

    <AppAlert v-if="units.length === 0" tone="error">
      Só o dono e quem opera o caixa abrem e fecham turno.
    </AppAlert>
    <template v-else>
      <div v-if="units.length > 1" role="group" aria-label="Unidade" class="flex flex-wrap gap-2">
        <button
          v-for="item in units"
          :key="item.id"
          type="button"
          :aria-pressed="item.id === unit?.id"
          class="min-h-12 rounded-button border-2 px-4 font-bold"
          :class="
            item.id === unit?.id
              ? 'border-primary bg-primary-soft text-primary-deep'
              : 'border-border-strong bg-surface'
          "
          @click="selectedUnitId = item.id"
        >
          {{ item.name }}
        </button>
      </div>

      <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
      <AppAlert v-if="closedMessage" tone="success">
        <p>{{ closedMessage }}</p>
        <NuxtLink
          v-if="isOwner && closedShiftId"
          :to="`/painel/relatorios/turnos/${closedShiftId}`"
          class="inline-flex min-h-12 items-center gap-2 font-bold underline"
          data-testid="closed-shift-report"
        >
          <AppIcon name="chart" />
          Ver o relatório do turno
        </NuxtLink>
      </AppAlert>
      <p v-if="!loaded && !loadError" class="text-text-muted">Carregando…</p>

      <!-- Turno aberto -->
      <template v-else-if="shift">
        <section
          class="flex flex-col gap-3 rounded-card border-2 border-border bg-surface p-4"
          aria-labelledby="shift-title"
          data-testid="current-shift"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="shift-title" class="flex-1 text-xl">Turno aberto</h2>
            <StageChip status="ready" :label="SHIFT_TYPE_LABELS[shift.type]" />
          </div>
          <p class="text-text-muted">
            {{ unit?.name }} · aberto em {{ formatDateTime(shift.openedAt) }} {{ shiftWho }}
          </p>
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt class="text-sm text-text-muted">Abertas</dt>
              <dd class="font-display text-xl font-extrabold tabular-nums sm:text-2xl">
                {{ summary.open }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-text-muted">Fechando</dt>
              <dd class="font-display text-xl font-extrabold tabular-nums sm:text-2xl">
                {{ summary.closing }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-text-muted">Encerradas</dt>
              <dd class="font-display text-xl font-extrabold tabular-nums sm:text-2xl">
                {{ summary.closed }}
              </dd>
            </div>
            <div>
              <dt class="text-sm text-text-muted">Valor das comandas</dt>
              <dd
                class="font-display text-xl font-extrabold tabular-nums sm:text-2xl"
                data-testid="shift-total"
              >
                {{ formatCents(summary.totalCents) }}
              </dd>
            </div>
          </dl>
          <!-- Relatórios são só do dono (RN-07.07). -->
          <NuxtLink
            v-if="isOwner"
            :to="`/painel/relatorios/turnos/${shift.id}`"
            class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep underline"
            data-testid="shift-report-link"
          >
            <AppIcon name="chart" />
            Ver relatório parcial do turno
          </NuxtLink>
          <p class="text-sm" data-testid="shift-registers">
            Caixas abertos: {{ openRegisters }}.
            <NuxtLink
              :to="`/caixas?unidade=${unit?.id}`"
              class="inline-flex min-h-12 items-center font-bold text-primary-deep underline"
              >Ver caixas</NuxtLink
            >
          </p>
          <div v-if="shift.agreement" class="rounded-card bg-surface-muted p-3">
            <p class="font-bold">Acordo com {{ shift.agreement.contractorName }}</p>
            <p>{{ MODALITY_LABELS[shift.agreement.modality] }}</p>
            <p v-if="shift.agreement.agreedAmountCents !== null">
              Valor combinado: {{ formatCents(shift.agreement.agreedAmountCents) }}
            </p>
            <p v-if="shift.agreement.agreedQuantity !== null">
              Quantidade combinada: {{ shift.agreement.agreedQuantity }}
            </p>
            <p v-if="shift.agreement.limits">Limites: {{ shift.agreement.limits }}</p>
            <p v-if="shift.agreement.notes">Observação: {{ shift.agreement.notes }}</p>
          </div>
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="prices-title">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="prices-title" class="flex-1 text-xl">Preços do turno</h2>
            <AppButton
              v-if="!editingPrices"
              variant="secondary"
              :block="false"
              data-testid="edit-prices"
              @click="startEditPrices"
            >
              <AppIcon name="edit" />
              Editar preços
            </AppButton>
          </div>
          <template v-if="!editingPrices">
            <p v-if="shift.prices.length === 0" class="text-text-muted">
              Sem tabela própria: vale o preço do cardápio.
            </p>
            <ul v-else class="flex flex-col gap-1">
              <li
                v-for="price in shift.prices"
                :key="price.productId"
                class="flex justify-between gap-2 rounded-card border border-border bg-surface px-3 py-2"
              >
                <span class="font-bold">{{
                  menu.findProduct(price.productId)?.name ?? 'Produto'
                }}</span>
                <span class="tabular-nums">
                  {{ formatCents(price.priceCents) }}
                  <span v-if="menu.findProduct(price.productId)" class="text-sm text-text-muted">
                    (cardápio {{ formatCents(menu.findProduct(price.productId)!.priceCents) }})
                  </span>
                </span>
              </li>
            </ul>
          </template>
          <template v-else>
            <ShiftPricesEditor
              v-model="editInput"
              :categories="activeCategories"
              :errors="editErrors"
            />
            <ErrorAlert :error="pricesAction.error.value" @reload="load" />
            <div class="flex flex-wrap gap-2">
              <AppButton
                variant="secondary"
                :block="false"
                :loading="pricesAction.busy.value"
                data-testid="save-prices"
                @click="savePrices"
              >
                Salvar preços
              </AppButton>
              <AppButton variant="ghost" :block="false" @click="editingPrices = false">
                Cancelar
              </AppButton>
            </div>
          </template>
        </section>

        <section class="flex flex-col gap-3" aria-labelledby="close-title">
          <h2 id="close-title" class="text-xl">Fechar turno</h2>
          <p class="text-text-muted">
            Precisa de todas as comandas pagas, penduradas ou canceladas e de todos os caixas
            fechados.
          </p>
          <ConfirmAction
            label="Fechar turno"
            question="Fechar o turno agora? Depois disso ele não aceita mais nenhuma alteração."
            confirm-label="Fechar turno"
            :loading="closeAction.busy.value"
            @confirm="closeShift"
          />
          <ErrorAlert v-if="!pending" :error="closeAction.error.value" @reload="load" />
          <AppAlert v-if="pending" tone="error">
            <div data-testid="shift-pending">
              <p class="font-bold">{{ closeAction.error.value?.message }}</p>
              <p v-if="pending.tabs.length" class="mt-2">Comandas em aberto:</p>
              <ul class="mt-1 flex flex-col gap-1">
                <li v-for="tab in pending.tabs" :key="tab.id">
                  <NuxtLink
                    :to="`/balcao/comandas/${tab.number}`"
                    class="inline-flex min-h-12 items-center gap-2 font-bold underline"
                  >
                    {{ tab.number }} · {{ tab.customerName }} ({{ TAB_STATUS_LABELS[tab.status] }})
                  </NuxtLink>
                </li>
              </ul>
              <p v-if="pending.cashRegisters.length" class="mt-2">
                Caixas abertos:
                {{ pending.cashRegisters.map((register) => register.name).join(', ') }}.
                <NuxtLink
                  :to="`/caixas?unidade=${unit?.id}`"
                  class="inline-flex min-h-12 items-center font-bold underline"
                  >Fechar caixas</NuxtLink
                >
              </p>
            </div>
          </AppAlert>
        </section>

        <AppButton to="/estacoes">Abrir estações</AppButton>
      </template>

      <!-- Sem turno: abrir -->
      <form
        v-else
        class="flex flex-col gap-5"
        novalidate
        aria-labelledby="open-title"
        @submit.prevent="openShift"
      >
        <div class="flex flex-col gap-1">
          <h2 id="open-title" class="text-xl">Abrir turno</h2>
          <p class="text-text-muted">Nenhum turno aberto em {{ unit?.name }}.</p>
          <NuxtLink
            v-if="isOwner"
            :to="`/painel/relatorios?unidade=${unit?.id}`"
            class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep underline"
          >
            <AppIcon name="chart" />
            Relatórios dos turnos anteriores
          </NuxtLink>
        </div>
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 font-bold">Tipo do turno</legend>
          <label
            v-for="option in ['direct_sale', 'contracted'] as const"
            :key="option"
            class="flex min-h-14 items-center gap-3 rounded-card border-2 bg-surface px-4 font-bold"
            :class="
              type === option
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border-strong'
            "
          >
            <input
              v-model="type"
              type="radio"
              name="shift-type"
              :value="option"
              class="size-5 accent-primary"
            />
            {{ SHIFT_TYPE_LABELS[option] }}
            <span class="ml-auto text-sm font-normal">
              {{ option === 'direct_sale' ? 'vende ao público' : 'evento com contratante' }}
            </span>
          </label>
          <p class="text-sm text-text-muted">O tipo não muda depois de aberto.</p>
        </fieldset>

        <fieldset v-if="type === 'contracted'" class="flex flex-col gap-3">
          <legend class="mb-2 font-bold">Acordo do turno contratado</legend>
          <AppTextField
            v-model="agreement.contractorName"
            label="Contratante"
            :error="formErrors.contractorName"
            :maxlength="120"
          />
          <AppSelect v-model="agreement.modality" label="Modalidade" :options="modalityOptions" />
          <AppTextField
            v-model="agreement.agreedAmount"
            label="Valor combinado (opcional)"
            inputmode="decimal"
            prefix="R$"
            :error="formErrors.agreedAmount"
          />
          <AppTextField
            v-model="agreement.agreedQuantity"
            label="Quantidade combinada (opcional)"
            inputmode="numeric"
            hint="Usada na comparação do relatório do turno."
            :error="formErrors.agreedQuantity"
          />
          <AppTextField
            v-model="agreement.limits"
            label="Limites (opcional)"
            placeholder="Ex.: 500 espetos, das 18h às 23h"
          />
          <AppTextField v-model="agreement.notes" label="Observação (opcional)" />
        </fieldset>

        <details class="rounded-card border-2 border-border bg-surface p-3">
          <summary class="flex min-h-12 cursor-pointer items-center font-bold">
            Tabela de preços do turno (opcional)
          </summary>
          <div class="pt-3">
            <ShiftPricesEditor
              v-model="priceInput"
              :categories="activeCategories"
              :errors="formErrors.priceByProduct"
            />
          </div>
        </details>
        <AppAlert v-if="formErrors.prices" tone="error">{{ formErrors.prices }}</AppAlert>
        <ErrorAlert :error="openAction.error.value" @reload="load" />
        <AppButton type="submit" :loading="openAction.busy.value" data-testid="open-shift">
          Abrir turno
        </AppButton>
      </form>
    </template>
  </component>
</template>
