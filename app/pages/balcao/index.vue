<script setup lang="ts">
/**
 * Balcão (`/balcao`, spec 01, seção 14.1). O varal de comandas é da spec 04; por enquanto a
 * tela é provisória e traz só o atalho de esgotado do cardápio (spec 03, seção 9).
 */
useHead({ title: 'Balcão · Varal' })

const session = useSessionStore()
const workplace = useWorkplaceStore()

/** A estação de balcão escolhida em `/estacoes`, se ainda for liberada para este usuário. */
const place = computed(() => {
  for (const unit of session.me?.units ?? []) {
    const station = unit.stations.find(
      (item) => item.id === workplace.stationId && item.kind === 'counter',
    )
    if (station) return { unit, station }
  }
  return null
})
</script>

<template>
  <StationShell :title="place?.station.name ?? 'Balcão'" :unit-name="place?.unit.name">
    <template v-if="place">
      <AppAlert>
        O varal de comandas chega na próxima versão do Varal. Por enquanto, daqui você marca os
        produtos que acabaram.
      </AppAlert>
      <MenuSoldOutList :unit-id="place.unit.id" />
    </template>
    <AppAlert v-else>
      Escolha uma estação de balcão liberada para você em "Trocar de estação".
    </AppAlert>
  </StationShell>
</template>
