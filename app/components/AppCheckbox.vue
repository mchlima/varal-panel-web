<script setup lang="ts">
/** Caixa de seleção com alvo de toque de 48 px (spec 08) e descrição opcional. */
withDefaults(defineProps<{ label: string; description?: string; disabled?: boolean }>(), {
  description: undefined,
  disabled: false,
})
const model = defineModel<boolean>({ required: true })
const id = useId()
</script>

<template>
  <label
    :for="id"
    class="flex min-h-12 cursor-pointer items-center gap-3 py-1"
    :class="disabled ? 'cursor-not-allowed opacity-60' : ''"
  >
    <input
      :id="id"
      v-model="model"
      type="checkbox"
      :disabled="disabled"
      class="size-6 shrink-0 accent-primary"
    />
    <span class="flex flex-col">
      <span class="font-bold">{{ label }}</span>
      <span v-if="description" class="text-sm text-text-muted">{{ description }}</span>
    </span>
  </label>
</template>
