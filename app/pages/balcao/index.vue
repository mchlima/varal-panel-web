<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import type { TabSummary } from '~/lib/operation'

/**
 * Balcão (`/balcao`, spec 04, seção 8.1): varal de comandas do turno, busca e "Nova comanda".
 * Abrir comanda vai pela fila local (spec 01, seção 11); com rede, a tela segue para o pedido da
 * comanda nova; sem rede, a comanda fica "Na fila" no varal até a API dar o número.
 */
useHead({ title: 'Balcão · Varal' })

const { place, counter } = useCounterLive()
const operations = useOperations()

/** Atrasos mudam com o relógio (RN-04.23): o varal recarrega a cada minuto. */
useIntervalFn(() => {
  if (document.visibilityState === 'visible' && counter.shift) counter.reloadSoon()
}, 60_000)

const session = useSessionStore()
/** Dono e quem opera caixa abrem e fecham o turno (RN-04.02). */
const canManageShift = computed(() => session.isOwner || place.value?.unit.canOperateCash === true)

const creating = ref(false)
const openForm = ref(false)
const soldOutOpen = ref(false)
const createError = ref('')

/** Com rede a resposta chega rápido; passado isso, a comanda segue na fila e a tela libera. */
const WAIT_FOR_NUMBER_MS = 2_500

async function createTab(customerName: string) {
  const shift = counter.shift
  if (!shift) return
  creating.value = true
  createError.value = ''
  try {
    const { settled } = await operations.submit({
      path: `/api/v1/shifts/${shift.id}/tabs`,
      body: { customerName },
      label: `Abrir comanda de ${customerName}`,
      meta: { kind: 'tab.create', shiftId: shift.id, customerName },
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
      <template v-if="place && counter.shift" #actions>
        <NuxtLink
          v-if="canManageShift"
          :to="`/painel/turnos?unidade=${place.unit.id}`"
          class="flex min-h-12 items-center gap-1.5 rounded-button px-2 text-sm font-bold text-primary-deep"
        >
          <AppIcon name="calendar" />
          <span class="hidden sm:inline">Turno</span>
          <span class="sr-only sm:hidden">Turno</span>
        </NuxtLink>
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

      <AppAlert v-if="!place">
        Escolha uma estação de balcão liberada para você em "Trocar de estação".
      </AppAlert>
      <template v-else>
        <AppAlert v-if="counter.loadError" tone="error">{{ counter.loadError }}</AppAlert>
        <p v-if="!counter.shiftLoaded && counter.loading" class="text-text-muted">Carregando…</p>
        <template v-else-if="counter.shiftLoaded && !counter.shift">
          <NoShiftNotice :unit-id="place.unit.id" />
          <MenuSoldOutList :unit-id="place.unit.id" />
        </template>
        <TabBoard v-else-if="counter.shift" />
      </template>

      <template v-if="place && counter.shift" #footer>
        <AppButton data-testid="new-tab" @click="((createError = ''), (openForm = true))">
          <AppIcon name="plus" />
          Nova comanda
        </AppButton>
      </template>
    </OperationShell>

    <AppDialog v-model:open="openForm" title="Nova comanda">
      <NewTabForm :busy="creating" :error="createError" @submit="createTab" />
    </AppDialog>
    <AppDialog v-if="place" v-model:open="soldOutOpen" title="Esgotados">
      <MenuSoldOutList :unit-id="place.unit.id" />
    </AppDialog>
  </div>
</template>
