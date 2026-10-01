import { defineStore } from 'pinia'
import type { components } from '~/api/schema'
import { apiErrorMessage } from '~/lib/api-error'

export type OwnerAnnouncement = components['schemas']['OwnerAnnouncement']

/** Recarrega no máximo uma vez por minuto ao trocar de tela no painel. */
const RELOAD_AFTER_MS = 60_000

/**
 * Comunicados não lidos do dono (spec 02, RN-02.16): `GET /announcements/unread` e
 * `POST /announcements/{id}/read`. Durante o "entrar como" a leitura não é registrada
 * (a API ignora): a interface nem pede, só esconde o comunicado nesta sessão.
 */
export const useAnnouncementsStore = defineStore('announcements', () => {
  const items = ref<OwnerAnnouncement[]>([])
  /** Fechados durante o "entrar como": continuam não lidos para o dono. */
  const hidden = ref<string[]>([])
  const loadedAt = ref(0)

  const unread = computed(() => items.value.filter((a) => !hidden.value.includes(a.id)))

  async function load(options: { force?: boolean } = {}): Promise<void> {
    const session = useSessionStore()
    if (!session.isOwner) return
    if (!options.force && Date.now() - loadedAt.value < RELOAD_AFTER_MS) return
    const { $api } = useNuxtApp()
    try {
      const { data } = await $api.GET('/api/v1/announcements/unread')
      if (data) {
        items.value = data.data
        loadedAt.value = Date.now()
      }
    } catch {
      // Sem rede: fica com a última lista; a reconexão recarrega.
    }
  }

  /** Marca como lido (ou, no "entrar como", só esconde nesta sessão). */
  async function markRead(id: string): Promise<{ ok: boolean; message?: string }> {
    const session = useSessionStore()
    if (session.impersonation) {
      if (!hidden.value.includes(id)) hidden.value.push(id)
      return { ok: true }
    }
    const { $api } = useNuxtApp()
    try {
      const { error, response } = await $api.POST('/api/v1/announcements/{id}/read', {
        params: { path: { id } },
      })
      if (!response.ok) return { ok: false, message: apiErrorMessage(error) }
      items.value = items.value.filter((a) => a.id !== id)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: apiErrorMessage(error) }
    }
  }

  function clear() {
    items.value = []
    hidden.value = []
    loadedAt.value = 0
  }

  return { items, unread, load, markRead, clear }
})
