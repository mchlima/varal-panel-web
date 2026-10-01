<script setup lang="ts">
import type { LoginTab } from '~/components/LoginForm.vue'

useHead({ title: 'Entrar · Varal' })

const route = useRoute()
const initialTab = computed<LoginTab>(() => (route.query.aba === 'colaborador' ? 'staff' : 'owner'))
</script>

<template>
  <AuthShell title="Entrar" subtitle="Use o acesso que você recebeu.">
    <LoginForm :key="initialTab" :initial-tab="initialTab" />
    <InstallHint />
  </AuthShell>
</template>
