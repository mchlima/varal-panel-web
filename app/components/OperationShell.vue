<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { allStations } from '~/lib/routes'

/**
 * Moldura das telas de operação (balcão e estações; spec 08, seção 7; spec 01, seção 14.2):
 * cabeçalho do app, a barra da tela e a ação principal fixa no rodapé, alcançável com o polegar.
 *
 * Na tela inicial de cada estação (varal do balcão, tela da estação), a barra tem o botão
 * "Painel" para quem tem painel (RN-01.25) e o nome da estação, que é também o botão "Trocar de
 * estação" quando há mais de uma liberada (RN-01.26). Nas telas internas do balcão (comanda,
 * pedido, receber), a seta de voltar leva ao varal. Tudo por rotas normais, para o voltar do
 * navegador também funcionar (RN-01.27).
 */
const props = withDefaults(
  defineProps<{
    title: string
    unitName?: string
    /** Link de voltar (ex.: da comanda para o varal). Sem ele, "Painel" e "Trocar de estação". */
    back?: RouteLocationRaw
    backLabel?: string
    /** Largura total (estação no formato KDS, spec 04, seção 8.2) ou larga (balcão). */
    width?: 'narrow' | 'wide' | 'full'
    /** Mantido para as telas antigas: equivale a `width="wide"`. */
    wide?: boolean
    /** Tela cheia da estação: esconde o cabeçalho do app. */
    bare?: boolean
  }>(),
  {
    unitName: undefined,
    back: undefined,
    backLabel: 'Voltar',
    width: undefined,
    wide: false,
    bare: false,
  },
)
const slots = useSlots()
const session = useSessionStore()
const switcherOpen = ref(false)

const size = computed(() => props.width ?? (props.wide ? 'wide' : 'narrow'))
const container = computed(
  () => ({ narrow: 'max-w-3xl', wide: 'max-w-6xl', full: 'max-w-none' })[size.value],
)
const canSwitch = computed(() => allStations(session.me).length > 1)
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <AppHeader v-if="!bare" :wide="size !== 'narrow'" :full="size === 'full'" />
    <div class="border-b border-border bg-surface">
      <div class="mx-auto flex w-full items-center gap-2 px-4 py-2" :class="container">
        <NuxtLink
          v-if="back"
          :to="back"
          class="flex size-12 shrink-0 items-center justify-center rounded-button text-primary-deep hover:bg-primary-soft"
          :aria-label="backLabel"
          :title="backLabel"
        >
          <AppIcon name="arrow-left" />
        </NuxtLink>
        <NuxtLink
          v-else-if="session.hasPanel"
          to="/painel"
          class="flex min-h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-button border-2 border-border-strong bg-surface px-3 font-bold text-text hover:border-primary"
          data-testid="go-panel"
        >
          <AppIcon name="home" />
          Painel
        </NuxtLink>

        <div class="min-w-0 flex-1">
          <button
            v-if="!back && canSwitch"
            type="button"
            class="flex min-h-12 max-w-full items-center gap-1.5 rounded-button px-2 text-left hover:bg-primary-soft"
            data-testid="switch-station"
            @click="switcherOpen = true"
          >
            <span class="min-w-0">
              <span class="block truncate font-display text-xl leading-tight font-extrabold">{{
                title
              }}</span>
              <span class="block truncate text-sm text-text-muted">
                Trocar de estação<template v-if="unitName"> · {{ unitName }}</template>
              </span>
            </span>
            <AppIcon name="chevrons-down" class="text-primary-deep" />
          </button>
          <template v-else>
            <h1 class="truncate px-2 text-xl leading-tight">{{ title }}</h1>
            <p v-if="unitName" class="truncate px-2 text-sm text-text-muted">{{ unitName }}</p>
          </template>
        </div>
        <slot name="actions" />
      </div>
    </div>
    <slot name="top" />
    <main
      class="mx-auto flex w-full flex-col gap-4 px-4 pt-4"
      :class="[container, slots.footer ? 'pb-32' : 'pb-8']"
    >
      <slot />
    </main>
    <div
      v-if="slots.footer"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div class="mx-auto w-full px-4 py-3" :class="container">
        <slot name="footer" />
      </div>
    </div>
    <StationSwitcher v-if="canSwitch" v-model:open="switcherOpen" />
  </div>
</template>
