import { rejectionsOf } from '~/lib/operation'
import { rejectionsByLine } from '~/lib/order-builder'

/**
 * Comanda paga antes recusada depois de sair da fila (RN-05.12, CA-05.09; spec 01, seção 11):
 * nada foi gravado na API, então o pedido volta ao rascunho deste aparelho (com os itens
 * recusados marcados) e a tela explica. Os pagamentos não voltam: o balcão recebe de novo.
 * `skip` deixa de fora as recusas que a tela já explicou no lugar (resposta dentro da espera).
 */
export function usePayFirstFailures(skip: (key: string) => boolean = () => false) {
  const cart = useCartStore()
  const notice = ref('')

  useOperationFailures((meta, error, action) => {
    if (meta.kind !== 'tab.pay_first') return false
    if (skip(action.idempotencyKey)) return true
    const rejections =
      error.code === 'ORDER_REJECTED'
        ? rejectionsByLine(meta.lines, rejectionsOf(error.details))
        : {}
    cart.restore(meta.draftKey, meta.lines, rejections)
    cart.setCustomer(meta.draftKey, meta.customerName)
    notice.value = `Comanda paga antes de ${meta.customerName} não foi registrada: ${error.message} O pedido voltou para o rascunho; receba de novo.`
    return true
  })

  return { notice }
}
