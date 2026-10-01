<script setup lang="ts">
import type { components } from '~/api/schema'
import { formatDateTime } from '~/lib/datetime'

type SupportAccess = components['schemas']['SupportAccess']

/**
 * Acessos de suporte (spec 02, RN-02.22; CA-02.09): cada "entrar como" da equipe do Varal na
 * conta, com admin, motivo, início e fim.
 */
useHead({ title: 'Acessos de suporte · Varal' })

const { $api } = useNuxtApp()
const list = useCursorList<SupportAccess>((query) =>
  $api.GET('/api/v1/support-access', { params: { query } }),
)
const accesses = list.items
onMounted(list.reload)

function endLabel(access: SupportAccess): string {
  if (access.active || !access.endedAt) return 'Em andamento'
  const when = formatDateTime(access.endedAt)
  return access.endedBy === 'expired' ? `${when} (tempo esgotado)` : when
}
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Acessos de suporte</h1>
      <p class="text-text-muted">
        Vezes em que a equipe do Varal entrou na sua conta para ajudar, com o motivo informado.
      </p>
    </div>

    <AppAlert v-if="list.error.value && !accesses.length" tone="error">
      {{ list.error.value }}
    </AppAlert>
    <p v-else-if="list.loading.value" class="text-text-muted">Carregando…</p>
    <AppAlert v-else-if="!accesses.length">
      Nenhum acesso de suporte foi feito na sua conta.
    </AppAlert>
    <ul v-else class="flex flex-col gap-3" data-testid="support-access-list">
      <li
        v-for="access in accesses"
        :key="access.id"
        data-testid="support-access"
        class="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-display text-lg font-semibold">{{ access.adminName }}</span>
          <StatusChip
            :tone="access.active ? 'info' : 'inactive'"
            :label="access.active ? 'Em andamento' : 'Encerrado'"
          />
        </div>
        <p><span class="text-text-muted">Motivo:</span> {{ access.reason }}</p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt class="text-text-muted">Início</dt>
          <dd>{{ formatDateTime(access.startedAt) }}</dd>
          <dt class="text-text-muted">Fim</dt>
          <dd>{{ endLabel(access) }}</dd>
        </dl>
      </li>
    </ul>
    <AppAlert v-if="list.error.value && accesses.length" tone="error">
      {{ list.error.value }}
    </AppAlert>
    <LoadMoreButton
      v-if="list.hasMore.value"
      :loading="list.loadingMore.value"
      @click="list.loadMore"
    />
  </PanelShell>
</template>
