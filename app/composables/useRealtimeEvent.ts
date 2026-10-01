import type { RealtimeClient, UnitEventName, UnitEvents } from '~/lib/realtime'

/**
 * Ouve um evento de unidade do tempo real enquanto a tela estiver aberta (spec 03, seção 8).
 * Tempo real não é fonte de verdade: use junto com `useRealtimeResync` e ignore eventos com
 * versão menor ou igual à que a tela já tem.
 */
export function useRealtimeEvent<K extends UnitEventName>(
  event: K,
  handler: (payload: UnitEvents[K]) => void,
): void {
  const { $realtime } = useNuxtApp()
  const client = $realtime as RealtimeClient | undefined
  if (!client || typeof client.subscribe !== 'function') return
  const stop = client.subscribe<UnitEvents[K]>(event, handler)
  onScopeDispose(stop)
}
