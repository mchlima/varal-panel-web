import { liveQuery } from 'dexie'
import { OfflineQueue } from '~/lib/offline-queue'
import type { SessionManager } from '~/lib/session'
import type { VaralDatabase } from '~/lib/db'

/** Intervalo de segurança entre tentativas de esvaziar a fila (plano 2.3). */
const QUEUE_INTERVAL_MS = 30_000

/**
 * Fila offline (spec 01, seção 11): processador único, disparado quando a rede volta,
 * quando o app volta ao primeiro plano, a cada intervalo e quando o socket reconecta.
 */
export default defineNuxtPlugin({
  name: 'varal:queue',
  dependsOn: ['varal:api'],
  setup(nuxtApp): { provide: { queue: OfflineQueue | null } } {
    const db = nuxtApp.$db as VaralDatabase | null
    const connection = useConnectionStore()
    const session = nuxtApp.$sessionManager as SessionManager

    const queue: OfflineQueue | null = db
      ? new OfflineQueue({
          db,
          baseUrl: nuxtApp.$apiBaseUrl as string,
          send: (request) => session.fetch(request),
        })
      : null

    connection.queueAvailable = queue !== null

    const setOnline = () => {
      connection.online = navigator.onLine
    }

    window.addEventListener('online', () => {
      setOnline()
      if (!queue) return
      void queue.resetBackoff().then(() => queue.trigger())
    })
    window.addEventListener('offline', setOnline)

    if (queue && db) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void queue.trigger()
      })
      window.setInterval(() => void queue.trigger(), QUEUE_INTERVAL_MS)

      // Contagem e falhas reativas, inclusive com mudanças feitas por outra aba.
      liveQuery(() => db.queue.toArray()).subscribe({
        next: (actions) => {
          const pending = actions.filter((a) => a.status === 'pending')
          connection.pending = pending
          connection.pendingCount = pending.length
          connection.failed = actions.filter((a) => a.status === 'failed')
        },
        error: () => {
          connection.queueAvailable = false
        },
      })

      void queue.trigger()
    }

    return { provide: { queue } }
  },
})
