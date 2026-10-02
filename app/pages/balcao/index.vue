<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import type { TabMode, TabSummary } from '~/lib/operation'
import { canOperateCashIn } from '~/lib/routes'

/**
 * Balcão (`/balcao`, spec 04, seção 8.1): faixa de operação (caixa, tabela efetiva, evento),
 * varal de comandas da unidade (de qualquer dia, RN-04.07), busca e "Nova comanda". Abrir
 * comanda vai pela fila local (spec 01, seção 11); com rede, a tela segue para o pedido da
 * comanda nova; sem rede, a comanda fica "Na fila" no varal até a API dar o número.
 *
 * Sem caixa aberto (RN-04.02, CA-05.08) o varal continua visível e as comandas podem ser
 * atendidas, mas "Nova comanda" fica desativada com "Abra um caixa para vender"; quem opera
 * caixa vê "Abrir caixa" como ação principal.
 */
useHead({ title: 'Balcão · Varal' })

/** Abas do balcão: o varal e o fiado da unidade (spec 06, seção 8; `?aba=fiado`). */
const route = useRoute()
const view = computed<'board' | 'credit'>(() => (route.query.aba === 'fiado' ? 'credit' : 'board'))
function showView(next: 'board' | 'credit') {
  void navigateTo(
    { query: { ...route.query, aba: next === 'credit' ? 'fiado' : undefined } },
    {
      replace: true,
    },
  )
}

const { place, counter, operation } = useCounterLive()
const operations = useOperationStore()
const operationsQueue = useOperations()
/** Paga antes recusada depois de sair da fila: o pedido volta ao rascunho e o aviso aparece. */
const { notice: payFirstNotice } = usePayFirstFailures()

/**
 * Atrasos que surgem só com o relógio (RN-04.23) não geram evento (o `tab.updated` traz os
 * contadores quando uma etapa muda): para eles, o varal recarrega a cada minuto.
 */
useIntervalFn(() => {
  if (document.visibilityState === 'visible' && counter.loaded) counter.reloadSoon()
}, 60_000)

const session = useSessionStore()
const canOpenCash = computed(() =>
  place.value ? canOperateCashIn(session.me, place.value.unit.id) : false,
)
/** RN-04.02: sem caixa aberto não se abre comanda. Enquanto a operação carrega, deixa abrir. */
const selling = computed(() => operation.value?.inOperation !== false)
const openCashPath = computed(() => {
  const registers = (operation.value?.cashRegisters ?? []).filter((item) => item.active)
  return registers.length === 1
    ? `/caixas/${registers[0]!.id}/abrir?volta=balcao`
    : '/caixas?volta=balcao'
})

const creating = ref(false)
const openForm = ref(false)
const soldOutOpen = ref(false)
const createError = ref('')

/** Com rede a resposta chega rápido; passado isso, a comanda segue na fila e a tela libera. */
const WAIT_FOR_NUMBER_MS = 2_500

async function createTab(customerName: string, mode: TabMode = 'open_tab') {
  const unitId = place.value?.unit.id
  if (!unitId) return
  // Paga antes (RN-05.12): a comanda só nasce paga, depois de montar o pedido e receber.
  if (mode === 'pay_first') {
    openForm.value = false
    await navigateTo({ path: '/balcao/paga-antes', query: { nome: customerName } })
    return
  }
  creating.value = true
  createError.value = ''
  try {
    const { settled } = await operationsQueue.submit({
      path: `/api/v1/units/${unitId}/tabs`,
      body: { customerName },
      label: `Abrir comanda de ${customerName}`,
      meta: { kind: 'tab.create', unitId, customerName },
    })
    const outcome = await Promise.race([
      settled,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_FOR_NUMBER_MS)),
    ])
    if (outcome?.ok) {
      const tab = outcome.body as TabSummary
      counter.board?.apply(tab)
      openForm.value = false
      await navigateTo(`/balcao/comandas/${tab.number}/pedido`)
      return
    }
    if (outcome && !outcome.ok) {
      createError.value = outcome.error.message
      if (outcome.error.code === 'NO_CASH_REGISTER_OPEN') void operations.load(unitId)
      return
    }
    // Sem resposta ainda (sem rede ou rede lenta): fica no varal como "Na fila".
    openForm.value = false
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div>
    <OperationShell :title="place?.station.name ?? 'Balcão'" :unit-name="place?.unit.name">
      <template v-if="place" #actions>
        <button
          type="button"
          class="flex min-h-12 items-center gap-1.5 rounded-button px-2 text-sm font-bold text-primary-deep"
          @click="soldOutOpen = true"
        >
          <AppIcon name="ban" />
          <span class="hidden sm:inline">Esgotados</span>
          <span class="sr-only sm:hidden">Esgotados</span>
        </button>
      </template>
      <template v-if="place" #top>
        <OperationStrip :unit-id="place.unit.id" :operation="operation" />
      </template>

      <AppAlert v-if="!place">
        <p class="font-bold">Escolha o balcão.</p>
        <p>Toque em "Trocar de estação" no topo, ou peça ao responsável para liberar um balcão.</p>
      </AppAlert>
      <template v-else>
        <AppAlert v-if="counter.loadError" tone="error">{{ counter.loadError }}</AppAlert>
        <AppAlert v-if="payFirstNotice" tone="error">
          <p>{{ payFirstNotice }}</p>
          <NuxtLink to="/balcao/paga-antes" class="font-bold underline">Abrir o rascunho</NuxtLink>
        </AppAlert>
        <div role="tablist" aria-label="Balcão" class="grid grid-cols-2 gap-2">
          <button
            v-for="option in [
              { value: 'board', label: 'Comandas', icon: 'receipt' },
              { value: 'credit', label: 'Fiado', icon: 'users' },
            ] as const"
            :key="option.value"
            type="button"
            role="tab"
            :aria-selected="view === option.value"
            class="flex min-h-12 items-center justify-center gap-2 rounded-button border-2 font-bold"
            :class="
              view === option.value
                ? 'border-primary bg-primary-soft text-primary-deep'
                : 'border-border bg-surface text-text'
            "
            :data-testid="`view-${option.value}`"
            @click="showView(option.value)"
          >
            <AppIcon :name="option.icon" />
            {{ option.label }}
          </button>
        </div>
        <CreditBoard v-if="view === 'credit'" :unit-id="place.unit.id" />
        <template v-else>
          <NoCashNotice v-if="!selling" :unit-id="place.unit.id" :primary="false" />
          <p v-if="!counter.loaded && counter.loading" class="text-text-muted">Carregando…</p>
          <TabBoard v-else :business-date="operation?.businessDate ?? null" :can-create="selling" />
        </template>
      </template>

      <template v-if="place && view === 'board'" #footer>
        <AppButton
          v-if="selling"
          data-testid="new-tab"
          @click="((createError = ''), (openForm = true))"
        >
          <AppIcon name="plus" />
          Nova comanda
        </AppButton>
        <AppButton v-else-if="canOpenCash" :to="openCashPath" data-testid="open-cash">
          <AppIcon name="wallet" />
          Abrir caixa
        </AppButton>
        <div v-else class="flex flex-col gap-1">
          <AppButton disabled data-testid="new-tab">
            <AppIcon name="plus" />
            Nova comanda
          </AppButton>
          <p class="text-center text-sm text-text-muted">Abra um caixa para vender.</p>
        </div>
      </template>
    </OperationShell>

    <AppDialog v-model:open="openForm" title="Nova comanda">
      <NewTabForm
        :busy="creating"
        :error="createError"
        :event-name="operation?.eventInProgress?.contractorName ?? null"
        @submit="createTab"
      />
    </AppDialog>
    <AppDialog v-if="place" v-model:open="soldOutOpen" title="Esgotados">
      <MenuSoldOutList :unit-id="place.unit.id" />
    </AppDialog>
  </div>
</template>
