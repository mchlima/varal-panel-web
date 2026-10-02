import { defineStore } from 'pinia'
import { apiErrorMessage } from '~/lib/api-error'
import { createTabBoard, type LiveCollection } from '~/lib/live-collection'
import type { TabSummary, WorkflowStage } from '~/lib/operation'
import type { EventTabCreated, EventTabUpdated } from '~/lib/realtime'

/** Espera para juntar vários eventos de item numa única recarga do varal. */
const RELOAD_DEBOUNCE_MS = 400

/**
 * Balcão (spec 04, seção 8.1): fluxo de etapas e o varal de comandas da unidade (`open` e
 * `closing`, de qualquer dia de operação, RN-04.07). A situação da operação (caixa aberto,
 * tabela efetiva, evento) fica no `useOperationStore`. O REST é a fonte da verdade (RN-01.05);
 * os eventos `tab.*` atualizam os cartões por `version`, inclusive os contadores de prontos e
 * atrasados. O fluxo vem de `GET /units/{id}/workflow`, que o colaborador da unidade também lê.
 */
export const useCounterStore = defineStore('counter', () => {
  const unitId = ref<string | null>(null)
  const counterStationId = ref<string | null>(null)
  const stages = ref<WorkflowStage[]>([])
  const board = ref<LiveCollection<TabSummary> | null>(null)
  /** O varal já foi carregado ao menos uma vez nesta unidade. */
  const loaded = ref(false)
  const loading = ref(false)
  const loadError = ref('')
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  const tabs = computed<TabSummary[]>(() =>
    board.value ? board.value.list().sort((a, b) => a.number - b.number) : [],
  )

  function boardOf(unit: string): LiveCollection<TabSummary> {
    if (!board.value) board.value = createTabBoard(unit)
    return board.value as LiveCollection<TabSummary>
  }

  /** Liga o balcão a uma unidade e estação de balcão e carrega tudo por REST. */
  async function open(unit: string, counterStation: string): Promise<void> {
    if (unitId.value !== unit) {
      stages.value = []
      board.value = null
      loaded.value = false
    }
    unitId.value = unit
    counterStationId.value = counterStation
    await load()
  }

  async function load(options: { stages?: boolean } = {}): Promise<void> {
    const unit = unitId.value
    if (!unit) return
    const { $api } = useNuxtApp()
    const current = ++generation
    const live = boardOf(unit)
    loading.value = true
    loadError.value = ''
    live.beginReload()
    try {
      const [tabsResult, workflowResult] = await Promise.all([
        $api.GET('/api/v1/units/{id}/tabs', {
          params: { path: { id: unit }, query: { status: 'open,closing' } },
        }),
        stages.value.length === 0 || options.stages
          ? $api.GET('/api/v1/units/{id}/workflow', { params: { path: { id: unit } } })
          : Promise.resolve(null),
      ])
      if (current !== generation) return
      if (workflowResult?.data) stages.value = workflowResult.data.stages
      if (!tabsResult.data) {
        loadError.value = apiErrorMessage(tabsResult.error)
        live.abortReload()
        return
      }
      live.finishReload(tabsResult.data.data)
      loaded.value = true
    } catch (error) {
      if (current !== generation) return
      loadError.value = apiErrorMessage(error)
      live.abortReload()
    } finally {
      if (current === generation) loading.value = false
    }
  }

  /** Recarga curta e agrupada (atrasos que surgem só com o passar do tempo). */
  function reloadSoon(): void {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void load()
    }, RELOAD_DEBOUNCE_MS)
  }

  function applyTab(event: EventTabCreated | EventTabUpdated): void {
    if (!unitId.value || event.unitId !== unitId.value) return
    boardOf(unitId.value).apply(event.data)
  }

  /** Comanda em aberto no varal pelo número (rota `/balcao/comandas/{numero}`, RN-04.09). */
  function tabByNumber(number: number): TabSummary | null {
    return tabs.value.find((tab) => tab.number === number) ?? null
  }

  function clear(): void {
    unitId.value = null
    counterStationId.value = null
    stages.value = []
    board.value = null
    loaded.value = false
  }

  return {
    unitId,
    counterStationId,
    stages,
    board,
    tabs,
    loaded,
    loading,
    loadError,
    open,
    load,
    reloadSoon,
    applyTab,
    tabByNumber,
    clear,
  }
})
