<script setup lang="ts">
import { formatRemaining } from '~/lib/impersonation'

/**
 * Faixa do "entrar como" (spec 02, RN-02.19; spec 08, seção 6): fixa no topo de todas as
 * telas enquanto a sessão de suporte durar. Fundo escuro com borda na primária, cor própria
 * para nunca se confundir com os avisos comuns (amarelo, vermelho claro).
 * "Encerrar acesso" é o logout desta sessão, que encerra o "entrar como" na API.
 */
const session = useSessionStore()
const connection = useConnectionStore()
const impersonation = computed(() => session.impersonation)

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1_000)
})
onBeforeUnmount(() => clearInterval(timer))

const remainingMs = computed(() =>
  impersonation.value ? Date.parse(impersonation.value.expiresAt) - now.value : 0,
)
const remaining = computed(() => formatRemaining(remainingMs.value))

const ending = ref(false)
// Ações na fila são desta sessão: encerrar antes de enviá-las as deixaria sem dono.
const blocked = computed(() => connection.pendingCount > 0)

// Chegou ao fim (60 min, CA-02.08): a API já recusa a sessão; recarregar o perfil leva ao
// login pela renovação recusada.
watch(
  () => impersonation.value !== null && remainingMs.value <= 0,
  (expired) => {
    if (expired && !ending.value) void session.restore()
  },
  { immediate: true },
)

async function end() {
  if (blocked.value || ending.value) return
  ending.value = true
  await session.endImpersonation()
  ending.value = false
  await navigateTo('/entrar', { replace: true })
}
</script>

<template>
  <div
    v-if="impersonation"
    role="region"
    aria-label="Acesso de suporte"
    data-testid="impersonation-banner"
    class="border-b-4 border-primary bg-text text-surface"
  >
    <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
      <p class="flex min-w-0 flex-1 basis-56 items-start gap-2 text-sm font-bold lg:text-base">
        <AppIcon name="eye" :size="22" class="mt-0.5" />
        <span data-testid="impersonation-text">
          Você está acessando como {{ session.me?.organization.name }} —
          {{ impersonation.adminName }}
        </span>
      </p>
      <p
        class="flex items-center gap-1 text-sm"
        data-testid="impersonation-remaining"
        aria-live="off"
      >
        <AppIcon name="clock" :size="16" />
        Restam {{ remaining }}
      </p>
      <button
        type="button"
        class="inline-flex min-h-12 items-center gap-2 rounded-button bg-surface px-4 font-bold text-text focus-visible:outline-surface disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="blocked || ending"
        @click="end"
      >
        <AppIcon name="log-out" />
        {{ ending ? 'Encerrando…' : 'Encerrar acesso' }}
      </button>
    </div>
    <p v-if="blocked" class="mx-auto w-full max-w-6xl px-4 pb-2 text-sm">
      Espere as ações pendentes serem enviadas para encerrar o acesso.
    </p>
  </div>
</template>
