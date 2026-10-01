import type { QueuedAction, QueuedActionError } from '~/lib/db'
import { operationMeta, type OperationMeta } from '~/lib/operation-actions'

/**
 * Recusas definitivas da fila (spec 01, seção 11) que a tela sabe explicar no lugar certo (ex.:
 * `ITEM_CHANGED` no cartão do item, CA-04.05; `ORDER_REJECTED` no pedido). A tela devolve `true`
 * quando tratou a recusa; ela sai da faixa do topo para não aparecer duas vezes. As outras
 * continuam na faixa, com o motivo e "Dispensar".
 */
export function useOperationFailures(
  handle: (meta: OperationMeta, error: QueuedActionError, action: QueuedAction) => boolean,
): void {
  const connection = useConnectionStore()
  const operations = useOperations()
  const seen = new Set<string>()

  watch(
    () => connection.failed,
    (failed) => {
      for (const action of failed) {
        if (seen.has(action.idempotencyKey)) continue
        const meta = operationMeta(action)
        if (!meta || !action.lastError) continue
        if (!handle(meta, action.lastError, action)) continue
        seen.add(action.idempotencyKey)
        void operations.dismissFailure(action)
      }
    },
    { immediate: true, deep: true },
  )
}
