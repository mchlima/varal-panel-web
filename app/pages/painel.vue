<script setup lang="ts">
/** Início do painel do dono (spec 01, seção 14.1). As seções do painel vêm nas specs 03 a 07. */
useHead({ title: 'Painel · Varal' })

const session = useSessionStore()
const firstName = computed(() => session.me?.subject.name.split(' ')[0] ?? '')
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <AppHeader />
    <main class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl">Olá, {{ firstName }}</h1>
        <p class="text-text-muted">
          {{ session.me?.organization.name }} · código da equipe
          <strong class="text-text">{{ session.me?.organization.accessCode }}</strong>
        </p>
      </div>
      <AppAlert>
        Cardápio, equipe, turnos e relatórios chegam nas próximas versões. Por enquanto, daqui você
        abre as estações.
      </AppAlert>
      <AppButton to="/estacoes">Abrir estações</AppButton>
      <InstallHint />
    </main>
  </div>
</template>
