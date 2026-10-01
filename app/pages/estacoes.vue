<script setup lang="ts">
import type { components } from '~/api/schema'
import { STATION_KIND_LABELS } from '~/lib/setup'

type StationSummary = components['schemas']['StationSummary']

/**
 * Escolha de unidade e estação (spec 01, seção 14). Se houver mais de uma unidade,
 * escolhe a unidade antes. As estações vêm do `/auth/me` (ativas, em ordem, com nome e tipo):
 * todas para o dono, as liberadas para o colaborador (RN-03.16). Balcão de pedidos leva ao
 * `/balcao`; fila, ao `/estacao/{id}` (spec 01, seção 14.1).
 */
useHead({ title: 'Estações · Varal' })

const session = useSessionStore()
const workplace = useWorkplaceStore()

const units = computed(() => session.me?.units ?? [])
const unit = computed(() => {
  if (units.value.length === 1) return units.value[0]
  return units.value.find((u) => u.id === workplace.unitId) ?? null
})
const stations = computed(() => unit.value?.stations ?? [])

async function open(station: StationSummary) {
  if (unit.value) workplace.selectUnit(unit.value.id)
  workplace.selectStation(station.id)
  await navigateTo(station.kind === 'counter' ? '/balcao' : `/estacao/${station.id}`)
}
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <AppHeader />
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <template v-if="units.length === 0">
        <h1 class="text-2xl">Estações</h1>
        <AppAlert>
          <template v-if="session.isOwner">Nenhuma unidade ativa nesta organização.</template>
          <template v-else>
            Você ainda não tem acesso a nenhuma unidade. Fale com o responsável pela barraca.
          </template>
        </AppAlert>
        <AppButton v-if="session.isOwner" to="/painel">Ir para o painel</AppButton>
      </template>

      <template v-else-if="!unit">
        <h1 class="text-2xl">Escolha a unidade</h1>
        <ul class="flex flex-col gap-3">
          <li v-for="item in units" :key="item.id">
            <button
              type="button"
              class="flex min-h-16 w-full items-center gap-3 rounded-card border-2 border-border-strong bg-surface px-4 text-left text-lg font-bold text-text hover:border-primary"
              @click="workplace.selectUnit(item.id)"
            >
              <AppIcon name="store" />
              <span class="flex-1">{{ item.name }}</span>
              <AppIcon name="chevron-right" />
            </button>
          </li>
        </ul>
      </template>

      <template v-else>
        <div class="flex flex-col gap-1">
          <p class="text-text-muted">{{ unit.name }}</p>
          <h1 class="text-2xl">Escolha a estação</h1>
        </div>

        <template v-if="stations.length === 0">
          <AppAlert>
            <p class="font-bold">Nenhuma estação configurada ainda.</p>
            <p v-if="session.isOwner">
              As estações (cozinha, balcão de entrega…) são criadas no painel, em Unidades →
              Estações e fluxo.
            </p>
            <p v-else>Fale com o responsável pela barraca para liberar uma estação para você.</p>
          </AppAlert>
          <AppButton v-if="session.isOwner" to="/painel">Ir para o painel</AppButton>
        </template>

        <ul v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <li v-for="station in stations" :key="station.id">
            <button
              type="button"
              :aria-pressed="workplace.stationId === station.id"
              class="flex min-h-20 w-full flex-col items-start justify-center rounded-card border-2 bg-surface px-4 py-3 text-left"
              :class="
                workplace.stationId === station.id
                  ? 'border-primary bg-primary-soft text-primary-deep'
                  : 'border-border-strong text-text hover:border-primary'
              "
              @click="open(station)"
            >
              <span class="font-display text-xl font-semibold">{{ station.name }}</span>
              <span
                class="text-sm"
                :class="workplace.stationId === station.id ? '' : 'text-text-muted'"
              >
                {{ STATION_KIND_LABELS[station.kind] }}
              </span>
            </button>
          </li>
        </ul>

        <AppButton
          v-if="units.length > 1"
          variant="ghost"
          :block="false"
          class="self-start"
          @click="workplace.selectUnit(null)"
        >
          <AppIcon name="arrow-left" />
          Trocar de unidade
        </AppButton>
      </template>

      <InstallHint />
    </main>
  </div>
</template>
