import { apiErrorMessage } from '~/lib/api-error'
import { applyItemToTab } from '~/lib/live-collection'
import type { OrderItem, Tab } from '~/lib/operation'

const RELOAD_DEBOUNCE_MS = 300

/**
 * Última versão lida de cada comanda (por unidade e número, ou pelo id), para a tela abrir com
 * ela sem rede enquanto o REST não responde (o pedido "Na fila" continua visível).
 */
const lastSeen = new Map<string, Tab>()

/**
 * Comanda em aberto da unidade pelo número (`/balcao/comandas/{numero}`, spec 01, seção 14.1;
 * RN-04.09: o número não se repete entre as comandas em aberto): busca `GET /tabs/{id}` e mantém
 * em tempo real. Itens mudam por `version` (`order_item.*`); pedido novo, totais e situação
 * recarregam por REST (`tab.updated`, `order.created`). A cada reconexão, recarrega (RN-01.05).
 *
 * Com `tabId` (`?comanda={id}`: comandas que não estão em aberto, como as do fiado, spec 06), a
 * comanda é buscada direto pelo id, com ou sem caixa aberto.
 */
export function useTabDetail(number: Ref<number>, tabId: Ref<string | null> = ref(null)) {
  const counter = useCounterStore()
  const { $api } = useNuxtApp()
  const cacheKey = () => tabId.value ?? `${counter.unitId ?? ''}:${number.value}`
  const tab = ref<Tab | null>(lastSeen.get(cacheKey()) ?? null)
  const loading = ref(false)
  const notFound = ref(false)
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight = false
  let again = false

  async function resolveId(): Promise<string | null> {
    if (tabId.value) return tabId.value
    const known = counter.tabByNumber(number.value)
    if (known) return known.id
    const unit = counter.unitId
    if (!unit) return null
    // A comanda que estava na tela pode ter acabado de ser paga e sair do varal: continua nela.
    if (tab.value?.number === number.value && tab.value.unitId === unit) return tab.value.id
    const { data } = await $api.GET('/api/v1/units/{id}/tabs', {
      params: { path: { id: unit }, query: { status: 'open,closing' } },
    })
    return data?.data.find((candidate) => candidate.number === number.value)?.id ?? null
  }

  async function load(): Promise<void> {
    if (inflight) {
      again = true
      return
    }
    if (!counter.unitId && !tabId.value) return
    inflight = true
    loading.value = true
    error.value = ''
    try {
      const id = await resolveId()
      if (!id) {
        notFound.value = true
        tab.value = null
        return
      }
      const { data, error: failure } = await $api.GET('/api/v1/tabs/{id}', {
        params: { path: { id } },
      })
      if (!data) {
        error.value = apiErrorMessage(failure)
        return
      }
      notFound.value = false
      tab.value = data
      lastSeen.set(tabId.value ?? `${data.unitId}:${data.number}`, data)
    } catch (cause) {
      error.value = apiErrorMessage(cause)
    } finally {
      inflight = false
      loading.value = false
      if (again) {
        again = false
        void load()
      }
    }
  }

  function reloadSoon(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load()
    }, RELOAD_DEBOUNCE_MS)
  }

  /** Item vindo de evento ou de resposta de ação; `remaining` é a linha original numa divisão. */
  function applyItem(item: OrderItem | null | undefined): void {
    if (!item || !tab.value) return
    if (inflight) again = true
    applyItemToTab(tab.value, item)
  }

  watch(
    () => [number.value, counter.unitId, tabId.value] as const,
    ([, unitId, id]) => {
      if (tab.value?.number !== number.value || (id && tab.value?.id !== id)) {
        tab.value = lastSeen.get(cacheKey()) ?? null
      }
      if (unitId || id) void load()
    },
    { immediate: true },
  )

  useRealtimeResync(() => load())
  useRealtimeEvent('tab.updated', (event) => {
    if (event.data.id === tab.value?.id && event.data.version > tab.value.version) reloadSoon()
  })
  useRealtimeEvent('order.created', (event) => {
    if (event.data.tabId !== tab.value?.id) return
    if (!tab.value.orders.some((order) => order.id === event.data.id)) reloadSoon()
  })
  useRealtimeEvent('order.completed', (event) => {
    if (event.data.tabId === tab.value?.id) reloadSoon()
  })
  useRealtimeEvent('order_item.stage_changed', (event) => {
    applyItem(event.data.item)
    applyItem(event.data.remaining)
  })
  useRealtimeEvent('order_item.canceled', (event) => {
    applyItem(event.data.item)
    applyItem(event.data.remaining)
  })

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { tab, loading, notFound, error, load, reloadSoon, applyItem }
}
