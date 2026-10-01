<script setup lang="ts">
import type { LoginTab } from '~/components/LoginForm.vue'

useHead({ title: 'Entrar · Varal' })

const route = useRoute()
const session = useSessionStore()
const initialTab = computed<LoginTab>(() => (route.query.aba === 'colaborador' ? 'staff' : 'owner'))
</script>

<template>
  <AuthShell title="Entrar" subtitle="Use o acesso que você recebeu.">
    <AppAlert v-if="session.impersonationEnded" data-testid="impersonation-ended">
      Acesso de suporte encerrado. Para entrar de novo nesta conta, abra outro acesso pelo admin do
      Varal.
    </AppAlert>
    <LoginForm :key="initialTab" :initial-tab="initialTab" />
    <InstallHint />
  </AuthShell>
</template>
