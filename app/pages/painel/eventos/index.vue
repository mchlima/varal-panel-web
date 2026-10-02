<script setup lang="ts">
import { agreementSummary, eventDates, sortEvents } from '~/lib/events'
import { MODALITY_LABELS, priceListName } from '~/lib/operation'

/**
 * Eventos contratados (`/painel/eventos`, spec 04, seção 8.3): em andamento no topo, depois os
 * agendados (mais próximos primeiro) e os encerrados. "Novo evento" é do dono; quem opera caixa
 * vê a lista e abre o evento para iniciar ou encerrar (RN-04.34).
 */
useHead({ title: 'Eventos · Varal' })

const session = useSessionStore()
const store = useContractedEventsStore()
const { unitId } = usePanelUnit()

const events = computed(() => sortEvents(store.eventsOf(unitId.value)))
const loaded = computed(() => !!unitId.value && unitId.value in store.byUnit)
const error = computed(() => (unitId.value ? (store.errors[unitId.value] ?? '') : ''))

function load() {
  if (unitId.value) void store.load(unitId.value)
}
watch(unitId, load, { immediate: true })
useRealtimeResync(load)
useRealtimeEvent('event.updated', (event) => {
  if (event.unitId === unitId.value) store.apply(event.data)
})
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Eventos</h1>
      <p class="text-text-muted">
        Festas, casamentos e outros atendimentos combinados com um contratante. Com o evento em
        andamento, as comandas novas ficam ligadas a ele e usam a tabela de preço dele.
      </p>
    </div>
    <UnitPicker />

    <AppButton v-if="session.isOwner" to="/painel/eventos/novo" data-testid="new-event">
      <AppIcon name="plus" />
      Novo evento
    </AppButton>

    <AppAlert v-if="error" tone="error">{{ error }}</AppAlert>
    <p v-else-if="!loaded" class="text-text-muted">Carregando eventos…</p>
    <AppAlert v-else-if="events.length === 0">
      <p class="font-bold">Nenhum evento cadastrado.</p>
      <p v-if="session.isOwner">
        Use quando a barraca for contratada para uma festa: cadastre o contratante, a data, o que
        foi combinado e, se quiser, uma tabela de preço própria. No dia, toque em "Iniciar evento".
      </p>
      <p v-else>
        Quando o dono cadastrar um evento, ele aparece aqui para você iniciar e encerrar.
      </p>
    </AppAlert>

    <ul v-else class="flex flex-col gap-3">
      <li v-for="event in events" :key="event.id">
        <NuxtLink
          :to="`/painel/eventos/${event.id}`"
          class="flex min-h-20 items-center gap-3 rounded-card border-2 bg-surface px-4 py-3 hover:border-primary"
          :class="event.status === 'in_progress' ? 'border-primary' : 'border-border'"
          data-testid="event-card"
        >
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="flex flex-wrap items-center gap-2">
              <span class="font-display text-lg font-semibold">{{ event.contractorName }}</span>
              <EventStatusChip :status="event.status" />
            </span>
            <span class="text-sm text-text-muted">
              {{ eventDates(event) }} · {{ MODALITY_LABELS[event.modality] }} · Preços:
              {{ priceListName(event.priceList) }}
            </span>
            <span v-if="agreementSummary(event)" class="text-sm text-text-muted">{{
              agreementSummary(event)
            }}</span>
          </span>
          <AppIcon name="chevron-right" />
        </NuxtLink>
      </li>
    </ul>
  </PanelShell>
</template>
