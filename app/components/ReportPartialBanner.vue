<script setup lang="ts">
/**
 * Faixa "Em andamento — valores parciais" (spec 07, RN-07.06; spec 08, seção 6: faixa de aviso
 * com texto e ícone), com o botão para atualizar.
 */
withDefaults(defineProps<{ loading?: boolean }>(), { loading: false })
const emit = defineEmits<{ refresh: [] }>()
</script>

<template>
  <div
    role="status"
    class="flex flex-wrap items-center gap-3 rounded-card bg-status-preparing-bg px-4 py-3 font-bold text-status-preparing-text"
    data-testid="report-partial"
  >
    <AppIcon name="clock" />
    <span class="flex-1">Em andamento — valores parciais</span>
    <button
      type="button"
      class="flex min-h-12 items-center gap-2 underline"
      :disabled="loading"
      @click="emit('refresh')"
    >
      <AppIcon name="refresh" />
      Atualizar
    </button>
  </div>
</template>
