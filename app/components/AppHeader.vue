<script setup lang="ts">
/** Cabeçalho das telas logadas: organização, pessoa, conexão e "Sair". */
withDefaults(defineProps<{ wide?: boolean; full?: boolean }>(), { wide: false, full: false })
const session = useSessionStore()
const connection = useConnectionStore()
const leaving = ref(false)

const status = computed(() => {
  if (!connection.online) return { icon: 'wifi-off', text: 'Sem conexão' } as const
  if (connection.realtime === 'connected') return { icon: 'wifi', text: 'Conectado' } as const
  return { icon: 'refresh', text: 'Conectando…' } as const
})

// Ações na fila são da sessão atual: sair antes de enviá-las as deixaria sem dono.
const blocked = computed(() => connection.pendingCount > 0)

async function logout() {
  if (blocked.value) return
  leaving.value = true
  await session.logout()
  await navigateTo('/entrar', { replace: true })
}
</script>

<template>
  <header class="border-b border-border bg-surface">
    <div
      class="mx-auto flex w-full items-center gap-3 px-4 py-2"
      :class="full ? 'max-w-none' : wide ? 'max-w-6xl' : 'max-w-3xl'"
    >
      <img src="/logo-symbol.svg" alt="" width="40" height="40" class="size-10" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-display text-lg font-semibold text-text">
          {{ session.me?.organization.name }}
        </p>
        <p class="flex items-center gap-2 truncate text-sm text-text-muted">
          <span class="truncate">{{ session.me?.subject.name }}</span>
          <span aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-1" data-testid="realtime-status">
            <AppIcon :name="status.icon" :size="14" />
            {{ status.text }}
          </span>
        </p>
      </div>
      <!-- No "entrar como", sair é o "Encerrar acesso" da faixa (RN-02.19). -->
      <AppButton
        v-if="!session.impersonation"
        variant="ghost"
        :block="false"
        :loading="leaving"
        :disabled="blocked"
        :title="blocked ? 'Espere as ações pendentes serem enviadas para sair.' : undefined"
        class="px-3"
        @click="logout"
      >
        <AppIcon v-if="!leaving" name="log-out" />
        Sair
      </AppButton>
    </div>
  </header>
</template>
