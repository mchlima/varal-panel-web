<script setup lang="ts">
import type { components } from '~/api/schema'
import { stationPath } from '~/lib/routes'
import { STATION_KIND_LABELS } from '~/lib/setup'

type StationSummary = components['schemas']['StationSummary']

/**
 * "Trocar de estação" (spec 01, RN-01.25): lista das estações liberadas, sem sair da tela atual
 * até escolher. Com mais de uma unidade, as estações aparecem agrupadas pela unidade. A troca
 * usa rota normal, para o voltar do navegador levar de volta (RN-01.27).
 */
const open = defineModel<boolean>('open', { required: true })
const session = useSessionStore()
const workplace = useWorkplaceStore()
const route = useRoute()

const units = computed(() => (session.me?.units ?? []).filter((unit) => unit.stations.length > 0))

function isCurrent(station: StationSummary): boolean {
  if (station.kind === 'queue') return route.path === `/estacao/${station.id}`
  return route.path.startsWith('/balcao') && workplace.stationId === station.id
}

async function choose(unitId: string, station: StationSummary) {
  workplace.selectUnit(unitId)
  workplace.selectStation(station.id)
  open.value = false
  await navigateTo(stationPath(station))
}
</script>

<template>
  <AppDialog v-model:open="open" title="Trocar de estação">
    <div class="flex flex-col gap-5">
      <section v-for="unit in units" :key="unit.id" class="flex flex-col gap-2">
        <h2 v-if="units.length > 1" class="text-lg">{{ unit.name }}</h2>
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <li v-for="station in unit.stations" :key="station.id">
            <button
              type="button"
              class="flex min-h-16 w-full items-center gap-3 rounded-card border-2 px-4 py-2 text-left"
              :class="
                isCurrent(station)
                  ? 'border-primary bg-primary-soft text-primary-deep'
                  : 'border-border-strong bg-surface text-text hover:border-primary'
              "
              :aria-current="isCurrent(station) ? 'page' : undefined"
              @click="choose(unit.id, station)"
            >
              <AppIcon :name="station.kind === 'counter' ? 'receipt' : 'station'" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-lg font-bold">{{ station.name }}</span>
                <span class="text-sm">{{ STATION_KIND_LABELS[station.kind] }}</span>
              </span>
              <AppIcon v-if="isCurrent(station)" name="check" />
            </button>
          </li>
        </ul>
      </section>
      <AppButton v-if="session.hasPanel" variant="secondary" to="/painel" @click="open = false">
        <AppIcon name="home" />
        Voltar ao painel
      </AppButton>
    </div>
  </AppDialog>
</template>
