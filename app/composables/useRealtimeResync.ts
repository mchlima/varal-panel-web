import type { ResyncHandler } from '~/plugins/04.realtime.client'

/**
 * Recarrega o estado da tela por REST a cada conexão ou reconexão do tempo real
 * (RN-01.05). Use nas telas que aplicam eventos (varal de comandas, fila da estação).
 */
export function useRealtimeResync(handler: ResyncHandler): void {
  const { $onResync } = useNuxtApp()
  if (typeof $onResync !== 'function') return
  const stop = ($onResync as (h: ResyncHandler) => () => void)(handler)
  onScopeDispose(stop)
}
