import { io } from 'socket.io-client'
import { createRealtimeClient, type RealtimeClient } from '~/lib/realtime'
import type { OfflineQueue } from '~/lib/offline-queue'
import type { SessionManager } from '~/lib/session'

export type ResyncHandler = () => void | Promise<void>

/**
 * Tempo real (spec 01, seção 10). Conecta enquanto houver sessão. A cada (re)conexão,
 * envia a fila e chama os ganchos de "recarregar estado" das telas (RN-01.05): eventos
 * perdidos durante a queda nunca são reenviados pelo servidor.
 */
export default defineNuxtPlugin({
  name: 'varal:realtime',
  dependsOn: ['varal:queue'],
  setup(nuxtApp): {
    provide: { realtime: RealtimeClient; onResync: (handler: ResyncHandler) => () => void }
  } {
    const session = useSessionStore()
    const connection = useConnectionStore()
    const manager = nuxtApp.$sessionManager as SessionManager
    const queue = nuxtApp.$queue as OfflineQueue | null
    const resyncHandlers = new Set<ResyncHandler>()

    // Perfil carregado do cache sem rede: atualiza assim que o servidor responder.
    resyncHandlers.add(() => (session.offline ? session.restore() : undefined))

    async function resync() {
      if (queue) {
        await queue.resetBackoff()
        await queue.trigger()
      }
      await Promise.allSettled([...resyncHandlers].map((handler) => handler()))
    }

    const client = createRealtimeClient({
      url: nuxtApp.$apiBaseUrl as string,
      getDeviceId: () => nuxtApp.$deviceId as string,
      io,
      refresh: () => manager.refresh(),
      onStatus: (status) => {
        connection.realtime = status
      },
      onConnected: () => {
        void resync()
      },
      onSessionEnded: () => {
        void nuxtApp.runWithContext(() => session.handleSessionLost())
      },
    })

    watch(
      () => session.status,
      (status) => {
        if (status === 'authenticated') client.connect()
        else client.disconnect()
      },
      { immediate: true },
    )

    /** Registra um gancho chamado a cada (re)conexão; devolve a função que o remove. */
    function onResync(handler: ResyncHandler): () => void {
      resyncHandlers.add(handler)
      return () => resyncHandlers.delete(handler)
    }

    return { provide: { realtime: client, onResync } }
  },
})
