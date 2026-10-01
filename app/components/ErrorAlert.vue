<script setup lang="ts">
import type { ExplainedError } from '~/lib/setup'

/** Erro de uma ação: a mensagem da API, a dica do que fazer e, no conflito, "Recarregar". */
defineProps<{ error: ExplainedError | null }>()
const emit = defineEmits<{ reload: [] }>()
</script>

<template>
  <AppAlert v-if="error" tone="error">
    <p class="font-bold">{{ error.message }}</p>
    <p v-if="error.hint" class="text-text">{{ error.hint }}</p>
    <AppButton
      v-if="error.code === 'VERSION_CONFLICT'"
      variant="secondary"
      :block="false"
      class="mt-2"
      @click="emit('reload')"
    >
      <AppIcon name="refresh" />
      Recarregar
    </AppButton>
  </AppAlert>
</template>
