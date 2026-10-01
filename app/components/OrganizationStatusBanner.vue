<script setup lang="ts">
/**
 * Faixa da situação da assinatura no painel do dono (spec 02, RN-02.12; CA-02.05): em
 * `suspended` e `canceled`, explica a situação e o motivo, e que não é possível abrir turno.
 * Turnos já abertos continuam até o fechamento.
 */
const session = useSessionStore()
const organization = computed(() => session.me?.organization)

const title = computed(() => {
  switch (organization.value?.subscriptionStatus) {
    case 'suspended':
      return 'Conta suspensa'
    case 'canceled':
      return 'Assinatura cancelada'
    default:
      return null
  }
})
</script>

<template>
  <div
    v-if="title"
    role="alert"
    data-testid="organization-status-banner"
    class="border-b border-status-late-text bg-status-late-bg text-status-late-text"
  >
    <div class="mx-auto flex w-full max-w-6xl items-start gap-3 px-4 py-3">
      <AppIcon name="ban" class="mt-0.5" />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <p class="font-bold">{{ title }}</p>
        <p v-if="organization?.suspendedReason">
          Motivo:
          <span data-testid="organization-status-reason">{{ organization.suspendedReason }}</span>
        </p>
        <p>
          Não é possível abrir turno. Um turno que já estava aberto pode ser operado até o
          fechamento. Fale com a equipe do Varal para reativar.
        </p>
      </div>
    </div>
  </div>
</template>
