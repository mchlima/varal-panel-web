import type { MenuProduct } from '~/lib/order-builder'

/**
 * Cardápio do balcão para montar pedido (spec 04, seção 8.1): categorias e produtos ativos em
 * ordem (RN-03.10), esgotados em tempo real (CA-03.05) e recarga na reconexão (RN-01.05).
 */
export function useCounterMenu(unitId: Ref<string | null>) {
  const menu = useMenuStore()

  watch(
    unitId,
    (id) => {
      if (id && (menu.unitId !== id || !menu.menu)) void menu.load(id)
    },
    { immediate: true },
  )
  useRealtimeResync(async () => {
    if (unitId.value) await menu.load(unitId.value)
  })
  useRealtimeEvent('product.sold_out_changed', menu.applySoldOut)
  useRealtimeEvent('menu.updated', menu.applyMenuUpdated)

  /** RN-03.10: categorias e produtos inativos não aparecem no balcão. */
  const categories = computed(() =>
    [...menu.categories]
      .filter((category) => category.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({
        ...category,
        products: [...category.products]
          .filter((product) => product.active)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((category) => category.products.length > 0),
  )

  function availableProduct(id: string): MenuProduct | null {
    for (const category of categories.value) {
      const product = category.products.find((item) => item.id === id)
      if (product) return product
    }
    return null
  }

  return { menu, categories, availableProduct }
}
