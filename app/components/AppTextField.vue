<script setup lang="ts">
/** Campo de formulário com rótulo, ajuda e erro ligados por `aria-describedby`. */
const props = withDefaults(
  defineProps<{
    label: string
    type?: 'text' | 'email' | 'password'
    autocomplete?: string
    inputmode?: 'text' | 'email' | 'numeric'
    autocapitalize?: 'none' | 'characters' | 'words' | 'sentences'
    hint?: string
    error?: string
    maxlength?: number
    required?: boolean
  }>(),
  {
    type: 'text',
    autocomplete: undefined,
    inputmode: undefined,
    autocapitalize: undefined,
    hint: undefined,
    error: undefined,
    maxlength: undefined,
    required: false,
  },
)

const model = defineModel<string>({ required: true })
const id = useId()
const revealed = ref(false)
const inputType = computed(() =>
  props.type === 'password' && revealed.value ? 'text' : props.type,
)
const describedBy = computed(
  () =>
    [props.hint ? `${id}-hint` : '', props.error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
    undefined,
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="id" class="font-bold">{{ label }}</label>
    <p v-if="hint" :id="`${id}-hint`" class="text-sm text-text-muted">{{ hint }}</p>
    <div class="relative">
      <input
        :id="id"
        v-model="model"
        :type="inputType"
        :autocomplete="autocomplete"
        :inputmode="inputmode"
        :autocapitalize="autocapitalize"
        :maxlength="maxlength"
        :required="required"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        spellcheck="false"
        class="min-h-12 w-full rounded-button border-2 bg-surface px-4 text-base text-text"
        :class="[
          error ? 'border-error' : 'border-border-strong',
          type === 'password' ? 'pr-14' : '',
        ]"
      />
      <button
        v-if="type === 'password'"
        type="button"
        class="absolute top-0 right-0 flex size-12 items-center justify-center rounded-button text-text-muted"
        :aria-label="revealed ? 'Ocultar senha' : 'Mostrar senha'"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <AppIcon :name="revealed ? 'eye-off' : 'eye'" />
      </button>
    </div>
    <p v-if="error" :id="`${id}-error`" class="flex items-center gap-1.5 text-sm text-error">
      <AppIcon name="alert-circle" :size="16" />
      {{ error }}
    </p>
  </div>
</template>
