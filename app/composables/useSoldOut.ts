import { apiErrorMessage } from '~/lib/api-error'
import { uuidv7 } from '~/lib/uuid'

/**
 * Esgotado (RN-03.11): ação operacional, feita do balcão e das estações a qualquer momento.
 * Vai pela fila offline com a `Idempotency-Key` gerada agora (spec 01, seção 11): sem
 * conexão, fica guardada e é enviada quando a rede voltar. Sem IndexedDB, envia direto.
 */
export function useSoldOut() {
  const menu = useMenuStore()
  const { $api } = useNuxtApp()
  const queue = useOfflineQueue()
  const error = ref('')

  async function setSoldOut(
    product: { id: string; name: string },
    soldOut: boolean,
  ): Promise<boolean> {
    error.value = ''
    const path = `/api/v1/products/${product.id}/sold-out`
    const label = soldOut
      ? `Marcar ${product.name} como esgotado`
      : `Liberar ${product.name} (não esgotado)`
    if (queue.available) {
      menu.markPending(product.id, soldOut)
      await queue.enqueue({ method: soldOut ? 'POST' : 'DELETE', path, label })
      return true
    }
    try {
      const options = {
        params: { path: { id: product.id }, header: { 'Idempotency-Key': uuidv7() } },
      }
      const result = soldOut
        ? await $api.POST('/api/v1/products/{id}/sold-out', options)
        : await $api.DELETE('/api/v1/products/{id}/sold-out', options)
      if (result.error !== undefined) {
        error.value = apiErrorMessage(result.error)
        return false
      }
      menu.markPending(product.id, soldOut)
      return true
    } catch (cause) {
      error.value = apiErrorMessage(cause)
      return false
    }
  }

  return { setSoldOut, error }
}
