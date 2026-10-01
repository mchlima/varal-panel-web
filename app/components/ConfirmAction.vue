<script setup lang="ts">
/**
 * Ação destrutiva (spec 08, seção 6): texto vermelho escuro e confirmação na própria tela,
 * nunca com diálogo do navegador.
 */
withDefaults(
  defineProps<{ label: string; question: string; confirmLabel?: string; loading?: boolean }>(),
  { confirmLabel: 'Confirmar', loading: false },
)
const emit = defineEmits<{ confirm: [] }>()
const asking = ref(false)

function confirm() {
  emit('confirm')
  asking.value = false
}
</script>

<template>
  <div>
    <button
      v-if="!asking"
      type="button"
      class="inline-flex min-h-12 items-center gap-2 rounded-button px-3 font-bold text-status-late-text underline-offset-4 hover:underline"
      :disabled="loading"
      @click="asking = true"
    >
      <slot name="icon" />
      {{ label }}
    </button>
    <div
      v-else
      role="group"
      :aria-label="question"
      class="flex flex-col gap-2 rounded-card border-2 border-status-late-text bg-status-late-bg p-3 text-status-late-text"
    >
      <p class="font-bold">{{ question }}</p>
      <slot />
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="min-h-12 rounded-button border-2 border-status-late-text bg-surface px-4 font-bold"
          :disabled="loading"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
        <button
          type="button"
          class="min-h-12 rounded-button px-4 font-bold underline"
          @click="asking = false"
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>
</template>
