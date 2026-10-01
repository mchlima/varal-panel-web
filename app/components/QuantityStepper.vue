<script setup lang="ts">
/** Quantidade com botões grandes de menos e mais (alvos de 48 px, spec 08). */
const props = withDefaults(defineProps<{ min?: number; max: number; label: string }>(), {
  min: 1,
})
const model = defineModel<number>({ required: true })

function change(delta: number) {
  model.value = Math.min(props.max, Math.max(props.min, model.value + delta))
}
</script>

<template>
  <div role="group" :aria-label="label" class="inline-flex items-center gap-1">
    <button
      type="button"
      class="flex size-12 items-center justify-center rounded-button border-2 border-border-strong bg-surface disabled:opacity-40"
      :disabled="model <= min"
      :aria-label="`Diminuir ${label.toLowerCase()}`"
      @click="change(-1)"
    >
      <AppIcon name="minus" />
    </button>
    <output
      class="min-w-12 text-center font-display text-2xl font-extrabold tabular-nums"
      aria-live="polite"
      >{{ model }}</output
    >
    <button
      type="button"
      class="flex size-12 items-center justify-center rounded-button border-2 border-border-strong bg-surface disabled:opacity-40"
      :disabled="model >= max"
      :aria-label="`Aumentar ${label.toLowerCase()}`"
      @click="change(1)"
    >
      <AppIcon name="plus" />
    </button>
  </div>
</template>
