<script setup lang="ts">
/**
 * Versão nova do app (plano 2.3): só é aplicada quando o usuário aceita e a fila offline
 * está vazia, para nunca recarregar no meio de um pedido.
 */
const { $pwa } = useNuxtApp()
const connection = useConnectionStore()
const updating = ref(false)

const visible = computed(() => Boolean($pwa?.needRefresh))
const blocked = computed(() => connection.pendingCount > 0)

async function update() {
  if (blocked.value || !$pwa) return
  updating.value = true
  await $pwa.updateServiceWorker(true)
}
</script>

<template>
  <div
    v-if="visible"
    role="status"
    class="flex flex-wrap items-center gap-3 border-b border-border bg-primary-soft px-4 py-2 text-primary-deep"
  >
    <AppIcon name="download" />
    <p class="flex-1 font-bold">
      Nova versão disponível
      <span v-if="blocked" class="block text-sm font-normal">
        Atualiza depois que as ações pendentes forem enviadas.
      </span>
    </p>
    <AppButton
      variant="secondary"
      :block="false"
      :disabled="blocked"
      :loading="updating"
      @click="update"
    >
      Atualizar
    </AppButton>
  </div>
</template>
