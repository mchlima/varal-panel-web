/**
 * Ações operacionais da spec 04 que passam pela fila local (spec 01, seção 11): abrir comanda,
 * enviar pedido, avançar, voltar, cancelar item, entregar, pedir a conta, reabrir e cancelar
 * comanda. O `meta` de cada ação diz à tela onde mostrar "Enviando…"/"Na fila" e sobrevive a um
 * recarregamento (fica no IndexedDB junto com a ação).
 */
import type { QueuedAction } from './db'
import type { CartLine } from './order-builder'

export type OperationMeta =
  | { kind: 'tab.create'; shiftId: string; customerName: string }
  | {
      kind: 'tab.order'
      tabId: string
      tabNumber: number
      lines: CartLine[]
    }
  | { kind: 'tab.request_bill' | 'tab.reopen' | 'tab.cancel'; tabId: string; tabNumber: number }
  | {
      kind: 'item.advance' | 'item.back' | 'item.cancel'
      itemId: string
      tabId: string
      quantity: number
      /** Etapa para onde vai (avançar/voltar), para "Enviando: Pronto". */
      toStageName?: string
      /** Avanço do balcão para a etapa final (RN-04.21). */
      deliver?: boolean
    }

export type OperationKind = OperationMeta['kind']

const KINDS: readonly OperationKind[] = [
  'tab.create',
  'tab.order',
  'tab.request_bill',
  'tab.reopen',
  'tab.cancel',
  'item.advance',
  'item.back',
  'item.cancel',
]

export function operationMeta(action: Pick<QueuedAction, 'meta'>): OperationMeta | null {
  const meta = action.meta as { kind?: unknown } | undefined
  return meta && KINDS.includes(meta.kind as OperationKind) ? (meta as OperationMeta) : null
}

export interface PendingOperation {
  action: QueuedAction
  meta: OperationMeta
}

/** Ações operacionais pendentes que satisfazem o filtro, em ordem de envio. */
export function pendingOperations(
  actions: readonly QueuedAction[],
  filter: (meta: OperationMeta) => boolean,
): PendingOperation[] {
  const result: PendingOperation[] = []
  for (const action of actions) {
    const meta = operationMeta(action)
    if (meta && filter(meta)) result.push({ action, meta })
  }
  return result
}

/** Ação pendente sobre um item (só uma por vez: a próxima esperaria a `version` nova). */
export function pendingForItem(
  actions: readonly QueuedAction[],
  itemId: string,
): PendingOperation | null {
  return (
    pendingOperations(
      actions,
      (meta) => meta.kind.startsWith('item.') && 'itemId' in meta && meta.itemId === itemId,
    )[0] ?? null
  )
}

/**
 * Situação honesta da ação (spec 01, seção 11): "Enviando…" enquanto a primeira tentativa está
 * em curso com rede; "Na fila" sem rede ou depois de uma tentativa que não passou.
 */
export function pendingLabel(action: Pick<QueuedAction, 'attempts'>, online: boolean): string {
  return online && action.attempts === 0 ? 'Enviando…' : 'Na fila'
}
