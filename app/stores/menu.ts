import { defineStore } from 'pinia'
import type { components } from '~/api/schema'
import { apiErrorMessage } from '~/lib/api-error'
import type { EventMenuUpdated, EventProductSoldOutChanged } from '~/lib/realtime'
import { isNewer } from '~/lib/setup'

type Schemas = components['schemas']
export type Menu = Schemas['Menu']
export type MenuCategory = Schemas['MenuCategory']
export type MenuProduct = Schemas['MenuProduct']
export type Station = Schemas['Station']

/**
 * Cardápio de uma unidade (`GET /units/{id}/menu`, spec 03, seção 5), compartilhado pelo
 * painel do dono e pelo atalho de esgotado do balcão e das estações. Tempo real só complementa:
 * a cada reconexão a tela recarrega por REST (RN-01.05) e eventos com versão menor ou igual
 * à conhecida são ignorados.
 */
export const useMenuStore = defineStore('menu', () => {
  const unitId = ref<string | null>(null)
  const menu = ref<Menu | null>(null)
  /** Estações da unidade (só o dono lê `GET /units/{id}/stations`). */
  const stations = ref<Station[]>([])
  const loading = ref(false)
  const loadError = ref('')
  /** Produtos com esgotado enviado por este aparelho e ainda não confirmado pelo servidor. */
  const pendingSoldOut = ref<Record<string, boolean>>({})

  const categories = computed(() => menu.value?.categories ?? [])
  const queueStations = computed(() =>
    stations.value.filter((station) => station.kind === 'queue' && station.active),
  )

  function stationName(id: string | null | undefined): string {
    if (!id) return ''
    return stations.value.find((station) => station.id === id)?.name ?? 'Estação'
  }

  function findProduct(id: string): MenuProduct | null {
    for (const category of categories.value) {
      const product = category.products.find((item) => item.id === id)
      if (product) return product
    }
    return null
  }

  async function load(id: string, options: { withStations?: boolean } = {}): Promise<boolean> {
    const { $api } = useNuxtApp()
    if (unitId.value !== id) {
      menu.value = null
      stations.value = []
    }
    unitId.value = id
    loading.value = true
    loadError.value = ''
    try {
      const [menuResult, stationsResult] = await Promise.all([
        $api.GET('/api/v1/units/{id}/menu', { params: { path: { id } } }),
        options.withStations
          ? $api.GET('/api/v1/units/{id}/stations', { params: { path: { id } } })
          : Promise.resolve(null),
      ])
      if (unitId.value !== id) return false
      if (!menuResult.data) {
        loadError.value = apiErrorMessage(menuResult.error)
        return false
      }
      menu.value = menuResult.data
      if (stationsResult?.data) stations.value = stationsResult.data.data
      pendingSoldOut.value = {}
      return true
    } catch (error) {
      loadError.value = apiErrorMessage(error)
      return false
    } finally {
      loading.value = false
    }
  }

  async function reload(): Promise<void> {
    if (unitId.value) await load(unitId.value, { withStations: stations.value.length > 0 })
  }

  /** `product.sold_out_changed`: bloqueia ou libera sem recarregar (CA-03.05). */
  function applySoldOut(event: EventProductSoldOutChanged): void {
    if (event.unitId !== unitId.value) return
    const product = findProduct(event.data.productId)
    if (!product || !isNewer(event.version, product.version)) return
    product.soldOut = event.data.soldOut
    product.version = event.version
    if (pendingSoldOut.value[product.id] === event.data.soldOut) {
      const { [product.id]: _done, ...rest } = pendingSoldOut.value
      pendingSoldOut.value = rest
    }
  }

  /** `menu.updated`: recarrega se a versão do evento for mais nova. */
  function applyMenuUpdated(event: EventMenuUpdated): void {
    if (event.data.unitId !== unitId.value) return
    if (isNewer(event.version, menu.value?.version)) void reload()
  }

  /** Marca a mudança feita neste aparelho até o servidor confirmar. */
  function markPending(productId: string, soldOut: boolean): void {
    const product = findProduct(productId)
    if (product) product.soldOut = soldOut
    pendingSoldOut.value = { ...pendingSoldOut.value, [productId]: soldOut }
  }

  function clear(): void {
    unitId.value = null
    menu.value = null
    stations.value = []
    pendingSoldOut.value = {}
  }

  return {
    unitId,
    menu,
    stations,
    loading,
    loadError,
    pendingSoldOut,
    categories,
    queueStations,
    stationName,
    findProduct,
    load,
    reload,
    applySoldOut,
    applyMenuUpdated,
    markPending,
    clear,
  }
})
