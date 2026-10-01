<script setup lang="ts">
import type { components } from '~/api/schema'
import { apiErrorMessage } from '~/lib/api-error'
import { isNewer } from '~/lib/setup'

type Station = components['schemas']['Station']
type Workflow = components['schemas']['Workflow']
type Unit = components['schemas']['Unit']

/**
 * Estações e fluxo de uma unidade (spec 03, seção 4; rota `/painel/unidades/{id}/fluxo`).
 * RN-03.07: com turno aberto, a API recusa mudar estações e fluxo (`SHIFT_OPEN`) e a tela
 * explica o motivo junto do erro.
 */
const route = useRoute()
const unitId = computed(() => String(route.params.id))
const { $api } = useNuxtApp()
const session = useSessionStore()

const unit = ref<Unit | null>(null)
const stations = ref<Station[]>([])
const workflow = ref<Workflow | null>(null)
const loading = ref(true)
const loadError = ref('')

useHead({ title: () => `${unit.value?.name ?? 'Unidade'} · Estações e fluxo · Varal` })

async function load() {
  loadError.value = ''
  const id = unitId.value
  try {
    const [units, stationList, flow] = await Promise.all([
      $api.GET('/api/v1/units'),
      $api.GET('/api/v1/units/{id}/stations', { params: { path: { id } } }),
      $api.GET('/api/v1/units/{id}/workflow', { params: { path: { id } } }),
    ])
    if (!stationList.data || !flow.data) {
      loadError.value = apiErrorMessage(stationList.error ?? flow.error)
      return
    }
    unit.value = units.data?.data.find((item) => item.id === id) ?? null
    stations.value = stationList.data.data
    workflow.value = flow.data
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  } finally {
    loading.value = false
  }
}

async function stationsChanged() {
  await Promise.all([load(), session.restore()])
}

watch(unitId, load, { immediate: true })
useRealtimeResync(load)
useRealtimeEvent('unit.config_updated', (event) => {
  if (event.data.unitId === unitId.value && isNewer(event.version, workflow.value?.version)) {
    void load()
  }
})
</script>

<template>
  <PanelShell>
    <NuxtLink
      to="/painel/unidades"
      class="inline-flex min-h-12 items-center gap-2 self-start font-bold text-primary-deep"
    >
      <AppIcon name="arrow-left" />
      Unidades
    </NuxtLink>
    <div class="flex flex-col gap-1">
      <p class="text-text-muted">{{ unit?.name }}</p>
      <h1 class="text-2xl">Estações e fluxo</h1>
    </div>

    <AppAlert>
      Com um turno aberto, estações e fluxo ficam travados para não bagunçar os pedidos em
      andamento. Faça as mudanças com o turno fechado.
    </AppAlert>

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="loading" class="text-text-muted">Carregando…</p>
    <div v-else-if="workflow" class="flex max-w-4xl flex-col gap-10">
      <StationsManager :unit-id="unitId" :stations="stations" @changed="stationsChanged" />
      <WorkflowEditor
        :unit-id="unitId"
        :workflow="workflow"
        :stations="stations"
        @saved="load"
        @reload="load"
      />
    </div>
  </PanelShell>
</template>
