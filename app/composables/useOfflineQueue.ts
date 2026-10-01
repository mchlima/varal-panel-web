import type { EnqueueInput, OfflineQueue } from '~/lib/offline-queue'

/**
 * Enfileira uma ação operacional (spec 01, seção 11). Ela é enviada na hora se houver
 * rede; senão, fica no aparelho e vai quando a conexão voltar, com a mesma
 * `Idempotency-Key`. Sem IndexedDB, devolve `null` e a tela deve avisar.
 */
export function useOfflineQueue() {
  const { $queue } = useNuxtApp()
  const queue = ($queue as OfflineQueue | null | undefined) ?? null

  return {
    available: queue !== null,
    enqueue: (input: EnqueueInput) => (queue ? queue.enqueue(input) : Promise.resolve(null)),
    dismiss: (seq: number) => queue?.dismiss(seq) ?? Promise.resolve(),
    retryNow: () => queue?.resetBackoff().then(() => queue.trigger()) ?? Promise.resolve(),
  }
}
