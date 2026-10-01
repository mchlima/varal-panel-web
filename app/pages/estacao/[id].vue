<script setup lang="ts">
/**
 * Fila de uma estação (`/estacao/{id}`, spec 01, seção 14.1). A fila em tempo real é da
 * spec 04; por enquanto a tela é provisória e traz só o atalho de esgotado (spec 03, seção 9).
 */
const route = useRoute()
const session = useSessionStore()
const workplace = useWorkplaceStore()
const stationId = computed(() => String(route.params.id))

/** Só estações liberadas no `/auth/me` (RN-03.16); a API confere de novo em cada ação. */
const place = computed(() => {
  for (const unit of session.me?.units ?? []) {
    const station = unit.stations.find((item) => item.id === stationId.value)
    if (station) return { unit, station }
  }
  return null
})

watch(
  place,
  (value) => {
    if (!value) return
    workplace.selectUnit(value.unit.id)
    workplace.selectStation(value.station.id)
  },
  { immediate: true },
)

useHead({ title: () => `${place.value?.station.name ?? 'Estação'} · Varal` })
</script>

<template>
  <StationShell :title="place?.station.name ?? 'Estação'" :unit-name="place?.unit.name">
    <template v-if="place">
      <AppAlert>
        A fila de itens desta estação chega na próxima versão do Varal. Por enquanto, daqui você
        marca os produtos que acabaram.
      </AppAlert>
      <MenuSoldOutList :unit-id="place.unit.id" />
    </template>
    <AppAlert v-else tone="error">
      Esta estação não existe ou não está liberada para você. Escolha outra em "Trocar de estação".
    </AppAlert>
  </StationShell>
</template>
