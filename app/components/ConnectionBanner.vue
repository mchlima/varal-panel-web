<script setup lang="ts">
/**
 * Faixa fixa no topo (spec 01, seções 11 e 14; spec 08, "faixa de aviso"): sem conexão,
 * ações aguardando envio e ações recusadas pela API, com o motivo.
 */
const connection = useConnectionStore()
const queue = useOfflineQueue()

function actions(count: number) {
  return count === 1 ? '1 ação aguardando envio' : `${count} ações aguardando envio`
}

const message = computed(() => {
  if (!connection.online) {
    return connection.pendingCount > 0
      ? `Sem conexão — ${actions(connection.pendingCount)}`
      : 'Sem conexão'
  }
  if (connection.pendingCount > 0) {
    return connection.pendingCount === 1
      ? 'Enviando 1 ação…'
      : `Enviando ${connection.pendingCount} ações…`
  }
  return null
})
</script>

<template>
  <div class="sticky top-0 z-50">
    <div
      v-if="message"
      role="status"
      data-testid="connection-banner"
      class="flex min-h-12 items-center gap-3 bg-status-preparing-bg px-4 py-2 font-bold text-status-preparing-text"
    >
      <AppIcon :name="connection.online ? 'refresh' : 'wifi-off'" />
      <span class="flex-1">{{ message }}</span>
    </div>
    <div
      v-for="action in connection.failed"
      :key="action.seq"
      role="alert"
      class="flex items-start gap-3 border-b border-border bg-status-late-bg px-4 py-2 text-status-late-text"
    >
      <AppIcon name="alert-circle" class="mt-1" />
      <p class="flex-1">
        <strong>Não enviada: {{ action.label }}.</strong>
        {{ action.lastError?.message }}
      </p>
      <button
        type="button"
        class="min-h-12 rounded-button px-3 font-bold underline underline-offset-4"
        @click="action.seq !== undefined && queue.dismiss(action.seq)"
      >
        Dispensar
      </button>
    </div>
  </div>
</template>
