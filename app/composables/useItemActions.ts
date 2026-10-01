import type { OrderItem } from '~/lib/operation'

/**
 * Mudanças de item (spec 04, seções 5.1 e 5.2) pela fila local, sempre com a `version` que o
 * aparelho conhece: se outro aparelho mudou o item antes, a API recusa com `ITEM_CHANGED` e o
 * estado atual (CA-04.05), em vez de aplicar a ação duas vezes.
 */
export function useItemActions() {
  const operations = useOperations()

  function describe(item: OrderItem, quantity: number) {
    return `${quantity} ${item.productName} (comanda ${item.tabNumber})`
  }

  /** RN-04.20, RN-04.24: avança tudo ou `quantity` (divide a linha). */
  function advance(
    item: OrderItem,
    options: { quantity?: number; toStageName?: string; deliver?: boolean } = {},
  ) {
    const quantity = options.quantity ?? item.quantity
    const partial = quantity < item.quantity
    const verb = options.deliver ? 'Entregar' : 'Avançar'
    return operations.submit({
      path: `/api/v1/order-items/${item.id}/advance`,
      body: partial ? { version: item.version, quantity } : { version: item.version },
      label: `${verb} ${describe(item, quantity)}${options.toStageName && !options.deliver ? ` para ${options.toStageName}` : ''}`,
      meta: {
        kind: 'item.advance',
        itemId: item.id,
        tabId: item.tabId,
        quantity,
        ...(options.toStageName ? { toStageName: options.toStageName } : {}),
        ...(options.deliver ? { deliver: true } : {}),
      },
    })
  }

  /** RN-04.22: volta uma etapa. */
  function back(item: OrderItem, toStageName?: string) {
    return operations.submit({
      path: `/api/v1/order-items/${item.id}/back`,
      body: { version: item.version },
      label: `Voltar ${describe(item, item.quantity)}${toStageName ? ` para ${toStageName}` : ''}`,
      meta: {
        kind: 'item.back',
        itemId: item.id,
        tabId: item.tabId,
        quantity: item.quantity,
        ...(toStageName ? { toStageName } : {}),
      },
    })
  }

  /** RN-04.25 a RN-04.27: cancela tudo ou parte, com motivo. */
  function cancel(item: OrderItem, quantity: number, reason: string) {
    const partial = quantity < item.quantity
    return operations.submit({
      path: `/api/v1/order-items/${item.id}/cancel`,
      body: partial
        ? { version: item.version, quantity, reason }
        : { version: item.version, reason },
      label: `Cancelar ${describe(item, quantity)}`,
      meta: { kind: 'item.cancel', itemId: item.id, tabId: item.tabId, quantity },
    })
  }

  return { advance, back, cancel }
}

/** Texto do estado pendente de uma ação de item ("Pronto: Enviando…", "Cancelar: Na fila"). */
export function itemPendingText(
  meta: { kind: string; toStageName?: string; deliver?: boolean; quantity: number },
  status: string,
): string {
  if (meta.kind === 'item.cancel') return `Cancelar ${meta.quantity}: ${status}`
  if (meta.deliver) return `Entrega: ${status}`
  const target = meta.toStageName ?? (meta.kind === 'item.back' ? 'Voltar' : 'Avançar')
  return `${target}: ${status}`
}
