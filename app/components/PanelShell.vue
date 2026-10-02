<script setup lang="ts">
import type { IconName } from './AppIcon.vue'

/**
 * Moldura do painel do dono (spec 08, seção 7): navegação lateral a partir de 1024 px;
 * abaixo disso, menu inferior fixo, alcançável com o polegar. Rotas da spec 01, seção 14.1.
 */
interface NavItem {
  to: string
  label: string
  short: string
  icon: IconName
  /** Só para o dono (o painel também abre para colaborador no turno e no fiado). */
  ownerOnly?: boolean
}

const items: NavItem[] = [
  { to: '/painel', label: 'Início', short: 'Início', icon: 'home' },
  { to: '/painel/turnos', label: 'Turno', short: 'Turno', icon: 'calendar' },
  { to: '/painel/unidades', label: 'Unidades', short: 'Unidades', icon: 'store' },
  { to: '/painel/cardapio', label: 'Cardápio', short: 'Cardápio', icon: 'menu' },
  { to: '/painel/colaboradores', label: 'Colaboradores', short: 'Equipe', icon: 'users' },
]

/** Só na navegação lateral; no celular, o atalho fica no início do painel. */
const sideOnly: NavItem[] = [
  { to: '/caixas', label: 'Caixas', short: 'Caixas', icon: 'wallet' },
  { to: '/painel/fiado', label: 'Fiado', short: 'Fiado', icon: 'users' },
  // Relatórios só do dono (RN-07.07).
  {
    to: '/painel/relatorios',
    label: 'Relatórios',
    short: 'Relatórios',
    icon: 'chart',
    ownerOnly: true,
  },
  { to: '/painel/acesso-da-equipe', label: 'Acesso da equipe', short: 'Acesso', icon: 'qr' },
  {
    to: '/painel/acessos-de-suporte',
    label: 'Acessos de suporte',
    short: 'Suporte',
    icon: 'eye',
  },
]

const route = useRoute()
const session = useSessionStore()
const sideItems = computed(() =>
  [...items, ...sideOnly].filter((item) => !item.ownerOnly || session.isOwner),
)
function isActive(item: NavItem): boolean {
  if (item.to === '/painel') return route.path === '/painel' || route.path === '/painel/'
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <AppHeader wide />
    <OrganizationStatusBanner />
    <AnnouncementsBanner />
    <div class="mx-auto flex w-full max-w-6xl">
      <nav
        aria-label="Painel"
        class="sticky top-[var(--top-banners,0px)] hidden h-[calc(100dvh-var(--top-banners,0px))] w-60 shrink-0 flex-col gap-1 self-start border-r border-border px-3 py-6 lg:flex"
      >
        <NuxtLink
          v-for="item in sideItems"
          :key="item.to"
          :to="item.to"
          :aria-current="isActive(item) ? 'page' : undefined"
          class="flex min-h-12 items-center gap-3 rounded-button px-3 font-bold"
          :class="
            isActive(item)
              ? 'bg-primary-soft text-primary-deep'
              : 'text-text hover:bg-surface-muted'
          "
        >
          <AppIcon :name="item.icon" />
          {{ item.label }}
        </NuxtLink>
        <hr class="my-3 border-border" />
        <NuxtLink
          to="/estacoes"
          class="flex min-h-12 items-center gap-3 rounded-button px-3 font-bold text-text hover:bg-surface-muted"
        >
          <AppIcon name="station" />
          Abrir estações
        </NuxtLink>
      </nav>
      <main class="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-28 lg:px-8 lg:pb-10">
        <slot />
      </main>
    </div>
    <nav
      aria-label="Painel"
      class="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        :aria-current="isActive(item) ? 'page' : undefined"
        class="flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold"
        :class="isActive(item) ? 'bg-primary-soft text-primary-deep' : 'text-text-muted'"
      >
        <AppIcon :name="item.icon" />
        {{ item.short }}
      </NuxtLink>
    </nav>
  </div>
</template>
