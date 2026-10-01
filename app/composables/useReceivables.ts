import { apiErrorMessage } from '~/lib/api-error'
import type { Receivables } from '~/lib/customer'

const RELOAD_DEBOUNCE_MS = 400

/**
 * Fiado a receber da unidade (spec 06, seção 8): `GET /units/{id}/receivables`, com as comandas
 * `on_credit` mais antigas primeiro, o total e os totais por cliente. O REST é a fonte da
 * verdade: um `tab.updated` de comanda pendurada, quitada ou que acabou de ser pendurada
 * recarrega a lista, e cada reconexão também (RN-01.05).
 */
export function useReceivables(unitId: Ref<string | null>) {
  const { $api } = useNuxtApp()
  const data = ref<Receivables | null>(null)
  const loading = ref(false)
  const error = ref('')
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    const unit = unitId.value
    if (!unit) return
    const current = ++generation
    loading.value = true
    error.value = ''
    try {
      const result = await $api.GET('/api/v1/units/{id}/receivables', {
        params: { path: { id: unit } },
      })
      if (current !== generation) return
      if (!result.data) {
        error.value = apiErrorMessage(result.error)
        return
      }
      data.value = result.data
    } catch (cause) {
      if (current === generation) error.value = apiErrorMessage(cause)
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reloadSoon(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load()
    }, RELOAD_DEBOUNCE_MS)
  }

  watch(
    unitId,
    (id) => {
      data.value = null
      if (id) void load()
    },
    { immediate: true },
  )

  useRealtimeResync(() => load())
  useRealtimeEvent('tab.updated', (event) => {
    if (event.unitId !== unitId.value) return
    const status = event.data.status
    const known = data.value?.tabs.find((tab) => tab.id === event.data.id)
    if (known && event.data.version <= known.version) return
    if (known || status === 'on_credit' || status === 'settled') reloadSoon()
  })

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { data, loading, error, load, reloadSoon }
}
