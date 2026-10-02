<script setup lang="ts">
/**
 * Seção recolhível do relatório do turno (spec 07, seção 9): o título e um número de destaque
 * ficam sempre à vista; o conteúdo abre com um toque, para o relatório caber no celular.
 */
withDefaults(defineProps<{ title: string; aside?: string; open?: boolean }>(), {
  aside: undefined,
  open: false,
})
</script>

<template>
  <details class="group rounded-card border-2 border-border bg-surface" :open="open">
    <summary
      class="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden"
    >
      <h2 class="min-w-0 flex-1 font-display text-lg font-bold">{{ title }}</h2>
      <span v-if="aside" class="text-right font-bold tabular-nums">{{ aside }}</span>
      <AppIcon name="chevron-right" class="transition-transform group-open:rotate-90" />
    </summary>
    <div class="flex flex-col gap-3 border-t border-border px-4 py-3">
      <slot />
    </div>
  </details>
</template>
