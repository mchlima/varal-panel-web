<script setup lang="ts">
import type { ContractedEvent } from '~/lib/operation'

/** Cadastro de evento (`/painel/eventos/novo`, spec 04, RN-04.05). Só o dono. */
useHead({ title: 'Novo evento · Varal' })

const store = useContractedEventsStore()
const { unitId } = usePanelUnit()

async function saved(event: ContractedEvent) {
  store.apply(event)
  await navigateTo(`/painel/eventos/${event.id}`, { replace: true })
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <NuxtLink
        to="/painel/eventos"
        class="inline-flex min-h-12 items-center gap-1 self-start font-bold text-primary-deep"
      >
        <AppIcon name="arrow-left" />
        Eventos
      </NuxtLink>
      <h1 class="text-2xl">Novo evento</h1>
      <p class="text-text-muted">
        O evento fica agendado. No dia, toque em "Iniciar evento" (ou aceite iniciar junto ao abrir
        o caixa).
      </p>
    </div>
    <UnitPicker />
    <EventForm v-if="unitId" :key="unitId" :unit-id="unitId" @saved="saved" />
  </PanelShell>
</template>
