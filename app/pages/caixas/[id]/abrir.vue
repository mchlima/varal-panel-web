<script setup lang="ts">
import { centsToInput, formatCents, parseReais } from '~/lib/money'
import { sinceLabel } from '~/lib/operation'
import { cashRegisterHint, type CashRegister } from '~/lib/payment'
import type { ExplainedError } from '~/lib/setup'

/**
 * Abrir caixa (`/caixas/{id}/abrir`, spec 05, seção 5.2 e tela "Abrir caixa"): fundo de troco com
 * a sugestão da abertura anterior (RN-05.23); aviso da tabela vigente quando não for "Normal",
 * com "Voltar para Normal" (spec 04, RN-04.31); oferta de iniciar o evento de hoje (RN-04.35).
 * Abrir é feito com conexão, com `Idempotency-Key`. Depois de abrir, volta ao balcão (quando veio
 * dele, `?volta=balcao`) ou ao início do painel, onde a ação principal passa a ser "Abrir balcão".
 */
const route = useRoute()
const { $api } = useNuxtApp()
const store = useOperationStore()
const registerId = computed(() => String(route.params.id))
const { unitId, unit, register, notFound, operation, reload } = useRegisterPlace(registerId)
const fromCounter = computed(() => route.query.volta === 'balcao')

useHead({ title: () => `Abrir ${register.value?.name ?? 'caixa'} · Varal` })

const floatInput = ref('')
const touched = ref(false)
/** Preenche o fundo com a sugestão assim que o caixa é conhecido. */
watch(
  register,
  (value) => {
    if (value && !floatInput.value)
      floatInput.value = centsToInput(value.suggestedOpeningFloatCents)
  },
  { immediate: true },
)
const floatCents = computed(() => (floatInput.value.trim() ? parseReais(floatInput.value) : null))
const floatError = computed(() => {
  if (!touched.value) return ''
  if (!floatInput.value.trim()) return 'Informe o troco inicial (pode ser 0).'
  return floatCents.value === null || floatCents.value < 0 ? 'Valor inválido.' : ''
})

/** RN-04.31: no primeiro caixa do dia, avisa a tabela vigente diferente de "Normal". */
const priceWarning = computed(() => {
  const current = operation.value
  if (!current || current.inOperation || current.eventInProgress) return null
  return current.currentPriceList
})
const priceAction = useApiAction()
async function backToNormal() {
  const current = operation.value
  if (!current || !unitId.value) return
  const result = await priceAction.run(() =>
    $api.PUT('/api/v1/units/{id}/current-price-list', {
      params: { path: { id: current.unitId } },
      body: { priceListId: null, version: current.version },
    }),
  )
  if (result.ok && result.data) store.apply(result.data, { fromRest: true })
}

/** RN-04.35: "Hoje tem o evento X. Iniciar junto?" (só sem evento em andamento). */
const eventsToday = computed(() =>
  operation.value?.eventInProgress ? [] : (operation.value?.eventsToday ?? []),
)
const startEventId = ref<string | null>(null)

const action = useApiAction()
const key = useIdempotencyKey()
const failure = ref<ExplainedError | null>(null)

async function open() {
  touched.value = true
  const current = register.value
  if (!current || floatError.value || floatCents.value === null) return
  failure.value = null
  const body = {
    openingFloatCents: floatCents.value,
    ...(startEventId.value ? { startEventId: startEventId.value } : {}),
  }
  const result = await action.run(() =>
    $api.POST('/api/v1/cash-registers/{id}/open', {
      params: { path: { id: current.id }, header: { 'Idempotency-Key': key.keyFor(body) } },
      body,
    }),
  )
  if (!result.ok) {
    const error = action.error.value
    failure.value = error ? { ...error, hint: cashRegisterHint(error.code) ?? error.hint } : null
    if (error?.code === 'CASH_REGISTER_ALREADY_OPEN') void reload()
    return
  }
  key.reset()
  if (result.data) store.applyRegister(result.data as CashRegister)
  await reload()
  await navigateTo(fromCounter.value ? '/balcao' : '/painel')
}

const alreadyOpen = computed(() => register.value?.session?.status === 'open')
const backTo = computed(() =>
  fromCounter.value
    ? '/caixas?volta=balcao'
    : unitId.value
      ? `/caixas?unidade=${unitId.value}`
      : '/caixas',
)
</script>

<template>
  <PanelShell>
    <NuxtLink
      :to="backTo"
      class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Caixas
    </NuxtLink>
    <div class="flex flex-col gap-1">
      <p v-if="unit" class="text-text-muted">{{ unit.name }}</p>
      <h1 class="text-2xl">Abrir {{ register?.name ?? 'caixa' }}</h1>
    </div>

    <AppAlert v-if="notFound" tone="error">
      Este caixa não existe, está desativado ou é de uma unidade em que você não opera caixa.
      <NuxtLink to="/caixas" class="font-bold underline">Ver os caixas</NuxtLink>
    </AppAlert>
    <p v-else-if="!register" class="text-text-muted">Carregando…</p>

    <template v-else-if="alreadyOpen && register.session">
      <AppAlert tone="success">
        <p class="font-bold" data-testid="already-open">
          {{ register.name }} já está aberto desde {{ sinceLabel(register.session.openedAt) }}.
        </p>
        <p>Aberto por {{ register.session.openedByName ?? 'Colaborador' }}.</p>
      </AppAlert>
      <AppButton :to="fromCounter ? '/balcao' : '/painel'">
        {{ fromCounter ? 'Voltar ao balcão' : 'Voltar ao início' }}
      </AppButton>
    </template>

    <form v-else class="flex max-w-xl flex-col gap-4" novalidate @submit.prevent="open">
      <p class="text-text-muted">
        Conte o dinheiro que está na gaveta para começar o dia. Com o caixa aberto, o balcão pode
        abrir comandas, lançar pedidos e receber.
      </p>
      <AppTextField
        v-model="floatInput"
        label="Troco inicial na gaveta"
        inputmode="decimal"
        prefix="R$"
        :hint="
          register.suggestedOpeningFloatCents > 0
            ? `Sugestão: ${formatCents(register.suggestedOpeningFloatCents)}, o troco da última abertura. Pode ser 0.`
            : 'Dinheiro na gaveta ao abrir. Pode ser 0.'
        "
        :error="floatError"
        autocomplete="off"
      />

      <div
        v-if="priceWarning"
        class="flex flex-col gap-2 rounded-card border-2 border-primary bg-primary-soft p-4 text-primary-deep"
        data-testid="price-list-warning"
      >
        <p class="flex items-center gap-2 font-bold">
          <AppIcon name="tag" />
          Preços vigentes: {{ priceWarning.name }}
        </p>
        <p>
          Os pedidos de hoje vão usar os preços da tabela {{ priceWarning.name }}. Se hoje é um dia
          normal, volte para o preço normal do cardápio.
        </p>
        <ErrorAlert :error="priceAction.error.value" />
        <AppButton
          variant="secondary"
          :loading="priceAction.busy.value"
          data-testid="price-list-normal"
          @click="backToNormal"
        >
          Voltar para Normal
        </AppButton>
      </div>

      <fieldset
        v-if="eventsToday.length"
        class="flex flex-col gap-2 rounded-card border-2 border-border bg-surface p-4"
        data-testid="event-today"
      >
        <legend class="px-1 font-bold">
          <span class="inline-flex items-center gap-2"
            ><AppIcon name="party" /> Evento de hoje</span
          >
        </legend>
        <label
          v-for="event in eventsToday"
          :key="event.id"
          class="flex min-h-12 items-center gap-3 font-bold"
        >
          <input
            type="checkbox"
            class="size-6 accent-primary"
            :checked="startEventId === event.id"
            @change="startEventId = ($event.target as HTMLInputElement).checked ? event.id : null"
          />
          <span>
            Hoje tem o evento {{ event.contractorName }}. Iniciar junto?
            <span class="block text-sm font-normal text-text-muted">
              As comandas novas ficam ligadas ao evento<template v-if="event.priceList">
                e usam os preços de {{ event.priceList.name }}</template
              >.
            </span>
          </span>
        </label>
      </fieldset>

      <ErrorAlert :error="failure" @reload="reload" />
      <AppButton type="submit" :loading="action.busy.value" data-testid="confirm-open">
        <AppIcon name="wallet" />
        Abrir {{ register.name }}
      </AppButton>
    </form>
  </PanelShell>
</template>
