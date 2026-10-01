import type { EnqueueInput, OfflineQueue, SettledListener } from '~/lib/offline-queue'

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
    dismiss: (seq: number) => {
      // Recusas do envio direto (sem IndexedDB) ficam só na memória, com `seq` negativo.
      if (!queue || seq < 0) {
        const connection = useConnectionStore()
        connection.failed = connection.failed.filter((action) => action.seq !== seq)
        return Promise.resolve()
      }
      return queue.dismiss(seq)
    },
    /** Ação aceita ou recusada de vez por este aparelho; devolve a função que para de ouvir. */
    onSettled: (listener: SettledListener) => queue?.onSettled(listener) ?? (() => {}),
    retryNow: () => queue?.resetBackoff().then(() => queue.trigger()) ?? Promise.resolve(),
  }
}
