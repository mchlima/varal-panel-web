<script setup lang="ts">
import type { components } from '~/api/schema'
import { apiErrorMessage } from '~/lib/api-error'
import { formatDateTime } from '~/lib/datetime'

type SupportAccess = components['schemas']['SupportAccess']

/**
 * Acessos de suporte (spec 02, RN-02.22; CA-02.09): cada "entrar como" da equipe do Varal na
 * conta, com admin, motivo, início e fim.
 */
useHead({ title: 'Acessos de suporte · Varal' })

const { $api } = useNuxtApp()
const accesses = ref<SupportAccess[] | null>(null)
const hasMore = ref(false)
const loadError = ref('')

async function load() {
  loadError.value = ''
  try {
    const { data, error } = await $api.GET('/api/v1/support-access')
    if (data) {
      accesses.value = data.data
      hasMore.value = data.nextCursor !== null
    } else loadError.value = apiErrorMessage(error)
  } catch (error) {
    loadError.value = apiErrorMessage(error)
  }
}
onMounted(load)

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

    <AppAlert v-if="loadError" tone="error">{{ loadError }}</AppAlert>
    <p v-else-if="!accesses" class="text-text-muted">Carregando…</p>
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
    <p v-if="hasMore" class="text-sm text-text-muted">Mostrando os acessos mais recentes.</p>
  </PanelShell>
</template>
