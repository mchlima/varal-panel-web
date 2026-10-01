<script setup lang="ts">
import { IMPERSONATION_LINK_MISSING } from '~/lib/impersonation'

/**
 * "Entrar como" (spec 02, RN-02.21; spec 01, seção 14.1). O admin abre
 * `/entrar-como#token=...`: o token vem no fragmento (não vai a servidores nem logs), sai da
 * barra de endereço na hora e é trocado por uma sessão do app como o dono
 * (`POST /auth/impersonation`, com o `X-Device-Id`). Depois, `/auth/me` e o painel.
 */
useHead({ title: 'Entrar como · Varal' })

const session = useSessionStore()
const error = ref('')
let started = false

onMounted(async () => {
  if (started) return
  started = true
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = params.get('token') ?? ''
  if (window.location.hash) {
    // Tira o token da barra de endereço e do histórico, mantendo o estado do roteador.
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    )
  }
  if (!token) {
    error.value = IMPERSONATION_LINK_MISSING
    return
  }
  const result = await session.exchangeImpersonation(token)
  if (!result.ok) {
    error.value = result.message ?? ''
    return
  }
  // Confere a sessão nova com os cookies do app antes de abrir o painel.
  await session.restore()
  if (!session.impersonation) {
    error.value = 'Não foi possível abrir o acesso de suporte. Gere um novo link pelo admin.'
    return
  }
  await navigateTo('/painel', { replace: true })
})
</script>

<template>
  <AuthShell title="Acesso de suporte" subtitle="Entrando na conta do cliente pelo admin do Varal.">
    <AppAlert v-if="error" tone="error">
      <p class="font-bold">Não foi possível entrar.</p>
      <p data-testid="impersonation-error">{{ error }}</p>
    </AppAlert>
    <p v-else role="status" class="flex items-center gap-2 text-text-muted">
      <AppIcon name="refresh" />
      Abrindo o painel…
    </p>
  </AuthShell>
</template>
