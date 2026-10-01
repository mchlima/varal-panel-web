<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

/**
 * Moldura das telas de operação (balcão e estações; spec 08, seção 7): cabeçalho com conexão,
 * título da tela com a unidade, conteúdo em largura de celular (ou larga no tablet) e a ação
 * principal fixa no rodapé, alcançável com o polegar.
 */
withDefaults(
  defineProps<{
    title: string
    unitName?: string
    /** Link de voltar (ex.: da comanda para o varal). Sem ele, "Trocar de estação". */
    back?: RouteLocationRaw
    backLabel?: string
    wide?: boolean
  }>(),
  { unitName: undefined, back: undefined, backLabel: 'Voltar', wide: false },
)
const slots = useSlots()
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <AppHeader wide />
    <div class="border-b border-border bg-surface">
      <div
        class="mx-auto flex w-full items-center gap-2 px-4 py-2"
        :class="wide ? 'max-w-6xl' : 'max-w-3xl'"
      >
        <NuxtLink
          :to="back ?? '/estacoes'"
          class="flex size-12 shrink-0 items-center justify-center rounded-button text-primary-deep hover:bg-primary-soft"
          :aria-label="back ? backLabel : 'Trocar de estação'"
          :title="back ? backLabel : 'Trocar de estação'"
        >
          <AppIcon :name="back ? 'arrow-left' : 'station'" />
        </NuxtLink>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-xl leading-tight">{{ title }}</h1>
          <p v-if="unitName" class="truncate text-sm text-text-muted">{{ unitName }}</p>
        </div>
        <slot name="actions" />
      </div>
    </div>
    <main
      class="mx-auto flex w-full flex-col gap-4 px-4 pt-4"
      :class="[wide ? 'max-w-6xl' : 'max-w-3xl', slots.footer ? 'pb-32' : 'pb-8']"
    >
      <slot />
    </main>
    <div
      v-if="slots.footer"
      class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div class="mx-auto w-full px-4 py-3" :class="wide ? 'max-w-6xl' : 'max-w-3xl'">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>
