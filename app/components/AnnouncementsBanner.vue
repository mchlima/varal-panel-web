<script setup lang="ts">
import { formatDate } from '~/lib/datetime'

/**
 * Comunicados não lidos no topo do painel do dono (spec 02, RN-02.16; CA-02.06): o dono
 * abre, lê e marca como lido, e o comunicado some da faixa. No "entrar como" a leitura não
 * é registrada: o botão só fecha, e o comunicado continua não lido para o dono.
 */
const MAX_LISTED = 3

const session = useSessionStore()
const store = useAnnouncementsStore()

onMounted(() => void store.load())
useRealtimeResync(() => store.load({ force: true }))

const listed = computed(() => store.unread.slice(0, MAX_LISTED))
const more = computed(() => store.unread.length - listed.value.length)

const openId = ref<string | null>(null)
const current = computed(() => store.unread.find((a) => a.id === openId.value) ?? null)
const dialogOpen = computed({
  get: () => current.value !== null,
  set: (value: boolean) => {
    if (!value) openId.value = null
  },
})

const saving = ref(false)
const error = ref('')

function open(id: string) {
  error.value = ''
  openId.value = id
}

async function markRead() {
  if (!current.value) return
  saving.value = true
  error.value = ''
  const result = await store.markRead(current.value.id)
  saving.value = false
  if (!result.ok) {
    error.value = result.message ?? ''
    return
  }
  // Abre o próximo não lido, se houver.
  openId.value = store.unread[0]?.id ?? null
}
</script>

<template>
  <section
    v-if="store.unread.length"
    aria-label="Comunicados"
    data-testid="announcements-banner"
    class="border-b border-border bg-primary-soft text-primary-deep"
  >
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-2">
      <p class="flex items-center gap-2 font-bold">
        <AppIcon name="message" />
        {{
          store.unread.length === 1
            ? '1 comunicado novo da equipe do Varal'
            : `${store.unread.length} comunicados novos da equipe do Varal`
        }}
      </p>
      <ul class="flex flex-col">
        <li v-for="announcement in listed" :key="announcement.id">
          <button
            type="button"
            class="flex min-h-12 w-full items-center gap-2 rounded-button text-left text-text hover:underline"
            @click="open(announcement.id)"
          >
            <span class="min-w-0 flex-1 truncate font-bold">{{ announcement.title }}</span>
            <span class="shrink-0 font-bold text-primary-deep">Ler</span>
            <AppIcon name="chevron-right" />
          </button>
        </li>
      </ul>
      <p v-if="more > 0" class="text-sm">
        e mais {{ more === 1 ? '1 comunicado' : `${more} comunicados` }}
      </p>
    </div>

    <AppDialog
      v-model:open="dialogOpen"
      :title="current?.title ?? 'Comunicado'"
      description="Comunicado da equipe do Varal"
    >
      <article v-if="current" class="flex flex-col gap-4" data-testid="announcement">
        <p class="text-sm text-text-muted">
          Equipe do Varal · {{ formatDate(current.publishedAt) }}
        </p>
        <MarkdownView :source="current.body" class="text-text" />
        <AppAlert v-if="session.impersonation">
          Você está no acesso de suporte: a leitura não é registrada e o comunicado continua não
          lido para o dono.
        </AppAlert>
        <AppAlert v-if="error" tone="error">{{ error }}</AppAlert>
        <AppButton v-if="session.impersonation" variant="secondary" @click="markRead">
          Fechar
        </AppButton>
        <AppButton v-else :loading="saving" @click="markRead">Marcar como lido</AppButton>
      </article>
    </AppDialog>
  </section>
</template>
