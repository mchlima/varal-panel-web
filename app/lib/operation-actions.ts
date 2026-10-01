/**
 * Ações operacionais que passam pela fila local (spec 01, seção 11). Spec 04: abrir comanda,
 * enviar pedido, avançar, voltar, cancelar item, entregar, pedir a conta, reabrir e cancelar
 * comanda. Spec 05: desconto, pagamento, estorno, comanda paga antes e sangria/suprimento.
 * Spec 06: pendurar (a quitação é um `tab.payment` numa comanda `on_credit`). O
 * `meta` de cada ação diz à tela onde mostrar "Enviando…"/"Na fila" e sobrevive a um
 * recarregamento (fica no IndexedDB junto com a ação).
 */
import type { QueuedAction } from './db'
import type { CartLine } from './order-builder'
import type { CashMovementType, DraftPayment, PaymentMethod } from './payment'

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
  | {
      kind: 'tab.discount'
      tabId: string
      tabNumber: number
      /** `true` ao remover o desconto. */
      remove: boolean
      /** Texto do desconto pedido ("10%", "R$ 5,00"), para "Desconto de 10%: na fila". */
      description: string
    }
  | {
      kind: 'tab.payment'
      tabId: string
      tabNumber: number
      method: PaymentMethod
      /** Pix e cartões: o valor; dinheiro: o valor entregue. */
      cents: number
      /** Troco calculado no aparelho (dinheiro), até a API confirmar o valor aplicado. */
      changeCents: number
      cashRegisterId: string | null
    }
  | {
      kind: 'payment.reverse'
      paymentId: string
      tabId: string
      tabNumber: number
    }
  | {
      kind: 'tab.pay_first'
      shiftId: string
      customerName: string
      /** Rascunho de onde o pedido saiu (carrinho do paga antes), para devolver se for recusado. */
      draftKey: string
      lines: CartLine[]
      payments: DraftPayment[]
      totalCents: number
    }
  | {
      kind: 'tab.put_on_credit'
      tabId: string
      tabNumber: number
      /** `null` no turno contratado `consumption_billed` (RN-06.08): a API usa o contratante. */
      customerId: string | null
      /** Nome mostrado em "Pendurar em Seu Zé: na fila". */
      customerName: string
      /** Saldo pendurado visto no aparelho ao confirmar (RN-06.06). */
      balanceCents: number
    }
  | {
      kind: 'cash.movement'
      cashRegisterId: string
      type: CashMovementType
      amountCents: number
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
  'tab.discount',
  'tab.payment',
  'payment.reverse',
  'tab.pay_first',
  'tab.put_on_credit',
  'cash.movement',
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

/**
 * Texto curto da ação pendente sobre uma comanda, para o cartão do varal e o topo da comanda
 * ("Pagamento: na fila"). `null` para ações que não são de uma comanda existente.
 */
export function tabActionName(meta: OperationMeta): string | null {
  switch (meta.kind) {
    case 'tab.order':
      return 'Pedido'
    case 'tab.request_bill':
      return 'Conta'
    case 'tab.reopen':
      return 'Reabrir'
    case 'tab.cancel':
      return 'Cancelar'
    case 'tab.discount':
      return 'Desconto'
    case 'tab.payment':
      return 'Pagamento'
    case 'payment.reverse':
      return 'Estorno'
    case 'tab.put_on_credit':
      return 'Pendurar'
    default:
      return null
  }
}

/** Comanda afetada pela ação, quando ela já existe na API. */
export function tabIdOf(meta: OperationMeta): string | null {
  return 'tabId' in meta ? meta.tabId : null
}
