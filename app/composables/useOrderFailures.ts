import { rejectionsOf } from '~/lib/operation'
import { rejectionsByLine } from '~/lib/order-builder'

/**
 * Pedido recusado depois de sair da fila (RN-04.17, CA-04.06; spec 01, seção 11): as linhas
 * voltam ao carrinho da comanda, com os itens problemáticos marcados, e a tela mostra o motivo.
 * Nada do que foi escolhido se perde.
 */
export function useOrderFailures(tabId: Ref<string | null>) {
  const cart = useCartStore()
  const notice = ref('')

  useOperationFailures((meta, error) => {
    if (meta.kind !== 'tab.order' || meta.tabId !== tabId.value) return false
    const rejections =
      error.code === 'ORDER_REJECTED'
        ? rejectionsByLine(meta.lines, rejectionsOf(error.details))
        : {}
    cart.restore(meta.tabId, meta.lines, rejections)
    notice.value =
      error.code === 'ORDER_REJECTED'
        ? `${error.message} O pedido voltou para o carrinho com os itens marcados.`
        : `Pedido não enviado: ${error.message} Ele voltou para o carrinho.`
    return true
  })

  return { notice }
}
