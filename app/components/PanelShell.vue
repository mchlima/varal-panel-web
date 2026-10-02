<script setup lang="ts">
import type { IconName } from './AppIcon.vue'

/**
 * Moldura do painel (spec 01, seção 14.2; spec 08, seção 7). Celular: menu inferior com Início,
 * Caixa, Balcão, Relatórios e Mais (dono) ou Início, Caixa, Balcão e Fiado (quem opera caixa).
 * A partir de 1024 px: navegação lateral com tudo e, separado, "Balcão e estações". "Eventos"
 * só aparece depois que a unidade tiver o primeiro evento (spec 04, seção 8.3).
 */
interface NavItem {
  to: string
  label: string
  short: string
  icon: IconName
  /** Explicação curta, para o "Mais". */
  text?: string
}

const route = useRoute()
const session = useSessionStore()
const events = useContractedEventsStore()
const { unit } = usePanelUnit()
const counter = useOpenCounter()
const moreOpen = ref(false)

const showEvents = computed(() => events.hasEvents(unit.value?.id))
const canCash = computed(() => session.isOwner || session.hasPanel)

watch(
  () => unit.value?.id,
  (id) => {
    if (id && canCash.value) void events.load(id)
  },
  { immediate: true },
)

const home: NavItem = { to: '/painel', label: 'Início', short: 'Início', icon: 'home' }
const cash: NavItem = {
  to: '/caixas',
  label: 'Caixa',
  short: 'Caixa',
  icon: 'wallet',
  text: 'Abrir e fechar o caixa, sangria e suprimento.',
}
const credit: NavItem = {
  to: '/painel/fiado',
  label: 'Fiado',
  short: 'Fiado',
  icon: 'users',
  text: 'Quem deve, quanto e as quitações.',
}
const reports: NavItem = {
  to: '/painel/relatorios',
  label: 'Relatórios',
  short: 'Relatórios',
  icon: 'chart',
  text: 'Venda e recebido por dia, por caixa e por evento.',
}
const eventsItem: NavItem = {
  to: '/painel/eventos',
  label: 'Eventos',
  short: 'Eventos',
  icon: 'party',
  text: 'Festas e casamentos combinados com um contratante.',
}
const setup: NavItem[] = [
  {
    to: '/painel/cardapio',
    label: 'Cardápio',
    short: 'Cardápio',
    icon: 'menu',
    text: 'Produtos, preços, opções e tabelas de preço.',
  },
  {
    to: '/painel/unidades',
    label: 'Unidades',
    short: 'Unidades',
    icon: 'store',
    text: 'Barracas, caixas, estações e etapas do pedido.',
  },
  {
    to: '/painel/colaboradores',
    label: 'Colaboradores',
    short: 'Equipe',
    icon: 'users',
    text: 'Quem trabalha, o que cada um pode abrir e senhas.',
  },
  {
    to: '/painel/acesso-da-equipe',
    label: 'Acesso da equipe',
    short: 'Acesso',
    icon: 'qr',
    text: 'Código, link e QR code para a equipe entrar.',
  },
  {
    to: '/painel/acessos-de-suporte',
    label: 'Acessos de suporte',
    short: 'Suporte',
    icon: 'eye',
    text: 'Quando a equipe do Varal entrou na sua conta.',
  },
]

/** Navegação lateral (a partir de 1024 px). */
const sideItems = computed<NavItem[]>(() => {
  if (session.isOwner) {
    return [home, cash, credit, reports, ...(showEvents.value ? [eventsItem] : []), ...setup]
  }
  if (session.hasPanel) return [home, cash, credit, ...(showEvents.value ? [eventsItem] : [])]
  return [credit]
})

/** "Mais" (dono, celular): o que não cabe no menu inferior. */
const moreItems = computed<NavItem[]>(() => [
  credit,
  { ...eventsItem, label: 'Eventos contratados' },
  { ...setup[0]!, label: 'Cardápio e tabelas de preço' },
  { ...setup[1]!, label: 'Unidades e caixas' },
  ...setup.slice(2),
])

function isActive(item: { to: string }): boolean {
  if (item.to === '/painel') return route.path === '/painel' || route.path === '/painel/'
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}
const moreActive = computed(() => moreItems.value.some(isActive))

function openCounter() {
  void counter.open(unit.value)
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
        class="sticky top-[var(--top-banners,0px)] hidden h-[calc(100dvh-var(--top-banners,0px))] w-60 shrink-0 flex-col gap-1 self-start overflow-y-auto border-r border-border px-3 py-6 lg:flex"
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
          data-testid="nav-operation"
        >
          <AppIcon name="station" />
          Balcão e estações
        </NuxtLink>
      </nav>
      <main class="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-28 lg:px-8 lg:pb-10">
        <slot />
      </main>
    </div>

    <nav
      aria-label="Painel"
      class="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      :class="session.isOwner ? 'grid-cols-5' : session.hasPanel ? 'grid-cols-4' : 'grid-cols-2'"
    >
      <template v-if="session.hasPanel">
        <NuxtLink
          v-for="item in [home, cash]"
          :key="item.to"
          :to="item.to"
          :aria-current="isActive(item) ? 'page' : undefined"
          class="flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold"
          :class="isActive(item) ? 'bg-primary-soft text-primary-deep' : 'text-text-muted'"
        >
          <AppIcon :name="item.icon" />
          {{ item.short }}
        </NuxtLink>
      </template>
      <button
        type="button"
        class="flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold text-text-muted"
        data-testid="nav-counter"
        @click="openCounter"
      >
        <AppIcon name="receipt" />
        Balcão
      </button>
      <NuxtLink
        v-for="item in session.isOwner ? [reports] : [credit]"
        :key="item.to"
        :to="item.to"
        :aria-current="isActive(item) ? 'page' : undefined"
        class="flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold"
        :class="isActive(item) ? 'bg-primary-soft text-primary-deep' : 'text-text-muted'"
      >
        <AppIcon :name="item.icon" />
        {{ item.short }}
      </NuxtLink>
      <button
        v-if="session.isOwner"
        type="button"
        class="flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold"
        :class="moreActive ? 'bg-primary-soft text-primary-deep' : 'text-text-muted'"
        :aria-expanded="moreOpen"
        data-testid="nav-more"
        @click="moreOpen = true"
      >
        <AppIcon name="grid" />
        Mais
      </button>
    </nav>

    <AppDialog v-model:open="moreOpen" title="Mais">
      <ul class="flex flex-col gap-2">
        <li v-for="item in moreItems" :key="item.to">
          <NuxtLink
            :to="item.to"
            class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-2 hover:border-primary"
            @click="moreOpen = false"
          >
            <AppIcon :name="item.icon" :size="24" class="text-primary-deep" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="font-bold">{{ item.label }}</span>
              <span v-if="item.text" class="text-sm text-text-muted">{{ item.text }}</span>
            </span>
            <AppIcon name="chevron-right" />
          </NuxtLink>
        </li>
        <li>
          <NuxtLink
            to="/estacoes"
            class="flex min-h-16 items-center gap-3 rounded-card border-2 border-border bg-surface px-4 py-2 hover:border-primary"
            @click="moreOpen = false"
          >
            <AppIcon name="station" :size="24" class="text-primary-deep" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="font-bold">Balcão e estações</span>
              <span class="text-sm text-text-muted">Abrir a cozinha ou outro balcão.</span>
            </span>
            <AppIcon name="chevron-right" />
          </NuxtLink>
        </li>
      </ul>
    </AppDialog>
    <CounterChooser
      :choices="counter.choices.value"
      @choose="counter.go"
      @close="counter.choices.value = null"
    />
  </div>
</template>
