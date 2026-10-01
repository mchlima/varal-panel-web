<script setup lang="ts">
import type { IconName } from '~/components/AppIcon.vue'

/** Início do painel do dono (spec 01, seção 14.1): atalhos para a configuração (spec 03). */
useHead({ title: 'Painel · Varal' })

const session = useSessionStore()
const firstName = computed(() => session.me?.subject.name.split(' ')[0] ?? '')

const sections: { to: string; title: string; text: string; icon: IconName }[] = [
  {
    to: '/painel/turnos',
    title: 'Turno',
    text: 'Abrir e fechar o turno, preços do turno e resumo das comandas.',
    icon: 'calendar',
  },
  {
    to: '/caixas',
    title: 'Caixas',
    text: 'Abrir caixa, sangria, suprimento e fechamento com conferência.',
    icon: 'wallet',
  },
  {
    to: '/painel/unidades',
    title: 'Unidades',
    text: 'Barracas, tempo de atraso, estações e fluxo de etapas.',
    icon: 'store',
  },
  {
    to: '/painel/cardapio',
    title: 'Cardápio',
    text: 'Categorias, produtos, preços, modificadores e esgotados.',
    icon: 'menu',
  },
  {
    to: '/painel/colaboradores',
    title: 'Colaboradores',
    text: 'Cadastro, estações liberadas, caixa e senhas.',
    icon: 'users',
  },
  {
    to: '/painel/acesso-da-equipe',
    title: 'Acesso da equipe',
    text: 'Código, link e QR code para a equipe entrar.',
    icon: 'qr',
  },
  {
    to: '/painel/acessos-de-suporte',
    title: 'Acessos de suporte',
    text: 'Quando a equipe do Varal entrou na sua conta, e por quê.',
    icon: 'eye',
  },
]
</script>

<template>
  <PanelShell>
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl">Olá, {{ firstName }}</h1>
      <p class="text-text-muted">
        {{ session.me?.organization.name }} · código da equipe
        <strong class="text-text">{{ session.me?.organization.accessCode }}</strong>
      </p>
    </div>
    <ul class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <li v-for="section in sections" :key="section.to">
        <NuxtLink
          :to="section.to"
          class="flex min-h-20 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-3 hover:border-primary"
        >
          <AppIcon :name="section.icon" :size="24" class="text-primary-deep" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="font-display text-lg font-semibold">{{ section.title }}</span>
            <span class="text-sm text-text-muted">{{ section.text }}</span>
          </span>
          <AppIcon name="chevron-right" />
        </NuxtLink>
      </li>
    </ul>
    <AppAlert>Caixa, fiado e relatórios chegam nas próximas versões.</AppAlert>
    <AppButton to="/estacoes">Abrir estações</AppButton>
    <InstallHint />
  </PanelShell>
</template>
