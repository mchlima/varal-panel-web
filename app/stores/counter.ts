import { defineStore } from 'pinia'
import { apiErrorMessage } from '~/lib/api-error'
import { createTabBoard, type LiveCollection } from '~/lib/live-collection'
import type { Shift, TabSummary, WorkflowStage } from '~/lib/operation'
import type {
  EventShiftClosed,
  EventShiftOpened,
  EventShiftUpdated,
  EventTabCreated,
  EventTabUpdated,
} from '~/lib/realtime'

/** Espera para juntar vários eventos de item numa única recarga do varal. */
const RELOAD_DEBOUNCE_MS = 400

/**
 * Balcão (spec 04, seção 8.1): turno atual da unidade, fluxo de etapas e o varal de comandas
 * (`open` e `closing`). O REST é a fonte da verdade (RN-01.05); os eventos `tab.*` atualizam os
 * cartões por `version`. Avanço de item não muda a `version` da comanda, então os contadores de
 * prontos e atrasados vêm de uma recarga curta do varal depois de `order_item.*`.
 */
export const useCounterStore = defineStore('counter', () => {
  const unitId = ref<string | null>(null)
  const counterStationId = ref<string | null>(null)
  const shift = ref<Shift | null>(null)
  /** O turno já foi consultado ao menos uma vez nesta unidade. */
  const shiftLoaded = ref(false)
  const stages = ref<WorkflowStage[]>([])
  const board = ref<LiveCollection<TabSummary> | null>(null)
  const loading = ref(false)
  const loadError = ref('')
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  let boardShiftId: string | null = null

  const tabs = computed<TabSummary[]>(() =>
    board.value ? board.value.list().sort((a, b) => a.number - b.number) : [],
  )

  function boardFor(shiftId: string): LiveCollection<TabSummary> {
    if (!board.value || boardShiftId !== shiftId) {
      board.value = createTabBoard(shiftId)
      boardShiftId = shiftId
    }
    return board.value as LiveCollection<TabSummary>
  }

  /** Liga o balcão a uma unidade e estação de balcão e carrega tudo por REST. */
  async function open(unit: string, counterStation: string): Promise<void> {
    if (unitId.value !== unit) {
      shift.value = null
      shiftLoaded.value = false
      stages.value = []
      board.value = null
      boardShiftId = null
    }
    unitId.value = unit
    counterStationId.value = counterStation
    await load()
  }

  async function load(): Promise<void> {
    const unit = unitId.value
    const station = counterStationId.value
    if (!unit || !station) return
    const { $api } = useNuxtApp()
    const current = ++generation
    loading.value = true
    loadError.value = ''
    board.value?.beginReload()
    try {
      const shiftResult = await $api.GET('/api/v1/units/{id}/shifts/current', {
        params: { path: { id: unit } },
      })
      if (current !== generation) return
      if (!shiftResult.data) {
        loadError.value = apiErrorMessage(shiftResult.error)
        board.value?.abortReload()
        return
      }
      const open = shiftResult.data.shift
      // O fluxo só muda com o turno fechado (RN-03.07): turno novo, etapas lidas de novo.
      if (open?.id !== shift.value?.id) stages.value = []
      shift.value = open
      shiftLoaded.value = true
      if (!open) {
        board.value = null
        boardShiftId = null
        return
      }
      const live = boardFor(open.id)
      if (!live.reloading) live.beginReload()
      const [tabsResult, queueResult] = await Promise.all([
        $api.GET('/api/v1/shifts/{id}/tabs', {
          params: { path: { id: open.id }, query: { status: 'open,closing' } },
        }),
        // O fluxo de etapas vem com a fila da estação; a do balcão é sempre vazia, mas traz as
        // etapas, que o colaborador não lê em `GET /units/{id}/workflow` (só o dono).
        stages.value.length === 0
          ? $api.GET('/api/v1/stations/{id}/queue', { params: { path: { id: station } } })
          : Promise.resolve(null),
      ])
      if (current !== generation) return
      if (queueResult?.data) stages.value = queueResult.data.stages
      if (!tabsResult.data) {
        loadError.value = apiErrorMessage(tabsResult.error)
        live.abortReload()
        return
      }
      live.finishReload(tabsResult.data.data)
    } catch (error) {
      if (current !== generation) return
      loadError.value = apiErrorMessage(error)
      board.value?.abortReload()
    } finally {
      if (current === generation) loading.value = false
    }
  }

  /** Recarga curta e agrupada (contadores de prontos e atrasados mudam sem `tab.updated`). */
  function reloadSoon(): void {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void load()
    }, RELOAD_DEBOUNCE_MS)
  }

  function applyTab(event: EventTabCreated | EventTabUpdated): void {
    if (event.unitId !== unitId.value || !shift.value) return
    if (event.data.shiftId !== shift.value.id) return
    boardFor(shift.value.id).apply(event.data)
  }

  function applyShift(event: EventShiftOpened | EventShiftUpdated | EventShiftClosed): void {
    if (event.unitId !== unitId.value) return
    if (event.type === 'shift.updated') {
      if (shift.value?.id === event.data.id && event.data.version > shift.value.version) {
        shift.value = event.data
      }
      return
    }
    // Abriu ou fechou: recarrega o turno e o varal inteiros.
    void load()
  }

  /** Comanda conhecida no varal pelo número (rota `/balcao/comandas/{numero}`). */
  function tabByNumber(number: number): TabSummary | null {
    return tabs.value.find((tab) => tab.number === number) ?? null
  }

  function clear(): void {
    unitId.value = null
    counterStationId.value = null
    shift.value = null
    shiftLoaded.value = false
    stages.value = []
    board.value = null
    boardShiftId = null
  }

  return {
    unitId,
    counterStationId,
    shift,
    shiftLoaded,
    stages,
    board,
    tabs,
    loading,
    loadError,
    open,
    load,
    reloadSoon,
    applyTab,
    applyShift,
    tabByNumber,
    clear,
  }
})
