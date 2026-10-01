<script setup lang="ts">
/** Lista de escolha nativa (abre o seletor do próprio celular), com rótulo, ajuda e erro. */
export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    options: SelectOption[]
    hint?: string
    error?: string
    disabled?: boolean
    /** Rótulo visualmente oculto (a linha já deixa claro o que é). */
    hideLabel?: boolean
  }>(),
  { hint: undefined, error: undefined, disabled: false, hideLabel: false },
)

const model = defineModel<string>({ required: true })
const id = useId()
const describedBy = computed(
  () =>
    [props.hint ? `${id}-hint` : '', props.error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
    undefined,
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="font-bold" :class="hideLabel ? 'sr-only' : ''">{{ label }}</label>
    <p v-if="hint" :id="`${id}-hint`" class="text-sm text-text-muted">{{ hint }}</p>
    <select
      :id="id"
      v-model="model"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="min-h-12 w-full rounded-button border-2 bg-surface px-3 text-base text-text disabled:cursor-not-allowed disabled:bg-surface-muted"
      :class="error ? 'border-error' : 'border-border-strong'"
    >
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>
    <p v-if="error" :id="`${id}-error`" class="flex items-center gap-1.5 text-sm text-error">
      <AppIcon name="alert-circle" :size="16" />
      {{ error }}
    </p>
  </div>
</template>
