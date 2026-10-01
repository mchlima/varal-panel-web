import { apiErrorMessage } from '~/lib/api-error'

/** Página de uma lista por cursor (spec 01, seção 5): `{ data, nextCursor }`. */
export interface CursorPage<T> {
  data: T[]
  nextCursor: string | null
}

/** Itens por página pedidos à API (ela aceita de 1 a 100). */
export const PAGE_SIZE = 50

type FetchPage<T> = (query: {
  limit: number
  cursor?: string
}) => Promise<{ data?: CursorPage<T>; error?: unknown }>

/**
 * Lista paginada por cursor, com "Carregar mais".
 *
 * - `reload()` busca de novo do início e traz tantos itens quanto os já carregados (pedindo as
 *   páginas seguintes), para uma atualização depois de uma edição ou de um evento em tempo
 *   real não esconder o que a pessoa já tinha aberto.
 * - `loadMore()` pede a página seguinte e junta ao fim.
 * - Uma resposta atrasada de um `reload()` anterior é descartada.
 */
export function useCursorList<T>(fetchPage: FetchPage<T>) {
  const items = ref<T[]>([]) as Ref<T[]>
  const nextCursor = ref<string | null>(null)
  const loaded = ref(false)
  const loadingMore = ref(false)
  const error = ref('')
  let generation = 0

  async function page(cursor?: string): Promise<CursorPage<T>> {
    const { data, error: failure } = await fetchPage({ limit: PAGE_SIZE, cursor })
    if (!data) throw failure ?? new Error('sem dados')
    return data
  }

  async function reload() {
    const current = ++generation
    const wanted = Math.max(items.value.length, 1)
    try {
      let result = await page()
      const collected = [...result.data]
      while (collected.length < wanted && result.nextCursor) {
        result = await page(result.nextCursor)
        collected.push(...result.data)
      }
      if (current !== generation) return
      items.value = collected
      nextCursor.value = result.nextCursor
      error.value = ''
    } catch (failure) {
      if (current !== generation) return
      error.value = apiErrorMessage(failure)
    } finally {
      if (current === generation) loaded.value = true
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return
    const current = generation
    loadingMore.value = true
    error.value = ''
    try {
      const result = await page(nextCursor.value)
      if (current !== generation) return
      items.value = [...items.value, ...result.data]
      nextCursor.value = result.nextCursor
    } catch (failure) {
      if (current === generation) error.value = apiErrorMessage(failure)
    } finally {
      loadingMore.value = false
    }
  }

  return {
    items,
    hasMore: computed(() => nextCursor.value !== null),
    /** Primeira carga ainda em andamento. */
    loading: computed(() => !loaded.value),
    loadingMore,
    error,
    reload,
    loadMore,
  }
}
