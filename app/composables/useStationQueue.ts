import { apiErrorMessage } from '~/lib/api-error'
import { readLocal, writeLocal } from '~/lib/browser'
import {
  changedItemOf,
  itemConflictMessage,
  type AdvanceOrderResult,
  type ItemChange,
  type OrderItem,
  type StationLine,
  type WorkflowStage,
} from '~/lib/operation'
import {
  applyItem,
  applyOrder,
  commonNextStageName,
  linesToAdvance,
  mergeReload,
  notStarted,
  previousStageName,
  pushRecent,
  recentFrom,
  refreshRecent,
  type ApplyResult,
  type CardMap,
  type RecentOrder,
  type StationCard,
  type StationLimits,
} from '~/lib/station'

const TOUCHED_KEY = 'varal.kdsTouched'
const TOUCHED_LIMIT = 300
const RELOAD_DEBOUNCE_MS = 300
const UNDO_MS = 5_000

export interface UndoNotice {
  id: number
  text: string
  lines: StationLine[]
}

function readTouched(): string[] {
  try {
    const parsed = JSON.parse(readLocal(TOUCHED_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Fila da estação em cartões por pedido (spec 04, seções 5.2 e 8.2; RN-04.39 a RN-04.46).
 *
 * Tempo real (RN-01.05, CA-04.12): a fila vem do REST ao abrir, a cada reconexão e logo depois de
 * cada evento (com espera curta para juntar vários); os eventos são aplicados na hora por
 * `version`, para a tela responder sem esperar. Toda mudança vai pela fila local com a `version`
 * conhecida (spec 01, seção 11).
 */
export function useStationQueue(options: {
  stationId: Ref<string>
  unitId: Ref<string | null>
  enabled: Ref<boolean>
  /** Item novo ou cancelado: som e vibração (spec 04, seção 8.2). */
  notify: () => void
}) {
  const { $api } = useNuxtApp()
  const operations = useOperations()
  const itemActions = useItemActions()

  const cards = ref<CardMap>({})
  const stages = ref<WorkflowStage[]>([])
  const limits = ref<StationLimits>({ attentionAfterMinutes: 7, lateAfterMinutes: 15 })
  const loaded = ref(false)
  const loadError = ref('')
  /** Aviso no cartão (outro aparelho mexeu antes, CA-04.05). */
  const notices = ref<Record<string, string>>({})
  /** Avisos de pedidos que já saíram desta tela. */
  const looseNotices = ref<{ id: string; text: string }[]>([])
  const recents = ref<RecentOrder[]>([])
  const undo = ref<UndoNotice | null>(null)
  /** Cartões que chegaram por evento com a tela aberta. */
  const fresh = ref<Record<string, true>>({})
  const touched = ref<string[]>(readTouched())
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let undoTimer: ReturnType<typeof setTimeout> | null = null
  let undoSeq = 0

  function remember(card: StationCard) {
    if (card.lines.some((line) => line.state === 'done')) {
      recents.value = pushRecent(recents.value, recentFrom(card, Date.now()))
    }
  }

  async function load(): Promise<void> {
    if (!options.enabled.value) return
    const current = ++generation
    try {
      const { data, error } = await $api.GET('/api/v1/stations/{id}/queue', {
        params: { path: { id: options.stationId.value } },
      })
      if (current !== generation) return
      if (!data) {
        loadError.value = apiErrorMessage(error)
        return
      }
      loadError.value = ''
      stages.value = data.stages
      limits.value = {
        attentionAfterMinutes: data.attentionAfterMinutes,
        lateAfterMinutes: data.lateAfterMinutes,
      }
      const result = mergeReload(cards.value, data.orders)
      if (loaded.value) for (const card of result.left) remember(card)
      cards.value = result.cards
      loaded.value = true
    } catch (error) {
      if (current !== generation) return
      loadError.value = apiErrorMessage(error)
    }
  }

  function reloadSoon(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void load()
    }, RELOAD_DEBOUNCE_MS)
  }

  function handle(result: ApplyResult, orderId: string) {
    if (result.arrived) {
      fresh.value = { ...fresh.value, [orderId]: true }
      options.notify()
    }
    if (result.canceledHere) options.notify()
    if (result.left) remember(result.left)
  }

  function receive(item: OrderItem | null | undefined): ApplyResult | null {
    if (!item) return null
    refreshRecent(recents.value, item, options.stationId.value)
    const result = applyItem(cards.value, item, options.stationId.value)
    handle(result, item.orderId)
    return result
  }

  watch(
    () => [options.stationId.value, options.enabled.value] as const,
    ([, enabled]) => {
      cards.value = {}
      loaded.value = false
      if (enabled) void load()
    },
    { immediate: true },
  )
  useRealtimeResync(load)

  const ofUnit = (unitId: string) => options.enabled.value && unitId === options.unitId.value

  useRealtimeEvent('order.created', (event) => {
    if (!ofUnit(event.unitId)) return
    const result = applyOrder(cards.value, event.data, options.stationId.value)
    handle(result, event.data.id)
    if (result.changed) reloadSoon()
  })
  useRealtimeEvent('order_item.stage_changed', (event) => {
    if (!ofUnit(event.unitId)) return
    const a = receive(event.data.item)
    const b = receive(event.data.remaining)
    if (a?.changed || b?.changed) reloadSoon()
  })
  useRealtimeEvent('order_item.canceled', (event) => {
    if (!ofUnit(event.unitId)) return
    const a = receive(event.data.item)
    const b = receive(event.data.remaining)
    if (a?.changed || b?.changed) reloadSoon()
  })
  // CA-04.24: limites da estação mudados valem na hora; fechar o último caixa encerra o preparo.
  useRealtimeEvent('unit.config_updated', (event) => {
    if (ofUnit(event.unitId)) void load()
  })
  useRealtimeEvent('unit.operation_updated', (event) => {
    if (ofUnit(event.unitId)) reloadSoon()
  })

  function showUndo(lines: StationLine[], card: { tabNumber: number }) {
    const target = lines[0]?.stageName ?? ''
    undo.value = { id: ++undoSeq, text: `Comanda ${card.tabNumber} · ${target}`, lines }
    if (undoTimer) clearTimeout(undoTimer)
    undoTimer = setTimeout(() => {
      undo.value = null
      undoTimer = null
    }, UNDO_MS)
  }

  /** Resposta de uma ação deste aparelho: aplica na hora e oferece desfazer se o cartão saiu. */
  operations.onSettled((meta, outcome) => {
    if (!outcome.ok) return
    const here = options.stationId.value
    if (meta.kind === 'order.advance' && meta.stationId === here) {
      const body = outcome.body as AdvanceOrderResult | undefined
      const card = cards.value[meta.orderId]
      for (const item of body?.items ?? []) receive(item)
      const moved = (body?.items ?? []).map((item) => ({
        ...item,
        state: 'done' as const,
      }))
      if (!cards.value[meta.orderId] && moved.every((line) => line.stationId !== here)) {
        showUndo(moved, card ?? { tabNumber: meta.tabNumber })
      }
      return
    }
    if (meta.kind === 'item.advance' || meta.kind === 'item.back' || meta.kind === 'item.cancel') {
      const change = outcome.body as ItemChange | undefined
      const orderId = change?.changed.orderId
      const before = orderId
        ? (cards.value[orderId] ?? recents.value.find((entry) => entry.orderId === orderId))
        : undefined
      receive(change?.remaining)
      receive(change?.changed)
      if (
        meta.kind === 'item.advance' &&
        before &&
        orderId &&
        !cards.value[orderId] &&
        change?.changed.stationId !== here
      ) {
        showUndo([{ ...change!.changed, state: 'done' }], before)
      }
    }
  })

  function cardOfLine(lineId: string): StationCard | undefined {
    return Object.values(cards.value).find((card) => card.lines.some((l) => l.id === lineId))
  }

  // CA-04.05, CA-04.17: outro aparelho mexeu antes; o cartão mostra o estado atual e o aviso.
  useOperationFailures((meta, failure) => {
    const here = options.stationId.value
    if (meta.kind === 'order.advance') {
      if (meta.stationId !== here) return false
      const details = failure.details as { items?: unknown } | undefined
      const items = Array.isArray(details?.items) ? (details.items as OrderItem[]) : []
      for (const item of items) receive(item)
      void load()
      const text =
        failure.code === 'ITEM_CHANGED'
          ? 'Outro aparelho mexeu neste pedido antes. O cartão já mostra como está agora: confira e toque de novo.'
          : failure.message
      if (cards.value[meta.orderId]) notices.value = { ...notices.value, [meta.orderId]: text }
      else
        looseNotices.value = [...looseNotices.value, { id: `${meta.orderId}:${Date.now()}`, text }]
      return true
    }
    if (!meta.kind.startsWith('item.') || !('itemId' in meta)) return false
    const card = cardOfLine(meta.itemId)
    const known = recents.value.some((entry) => entry.lines.some((l) => l.id === meta.itemId))
    if (!card && !known) return false
    const current = changedItemOf(failure.details)
    const message = itemConflictMessage(failure.code, current)
    if (!message) return false
    if (current) receive(current)
    void load()
    const target = current ? cardOfLine(current.id) : card
    if (target) notices.value = { ...notices.value, [target.orderId]: message }
    else
      looseNotices.value = [
        ...looseNotices.value,
        { id: `${meta.itemId}:${Date.now()}`, text: message },
      ]
    return true
  })

  // Ações -----------------------------------------------------------------------------------

  function touch(card: StationCard): void {
    if (touched.value.includes(card.orderId) && !(card.orderId in fresh.value)) return
    const { [card.orderId]: _done, ...rest } = fresh.value
    fresh.value = rest
    if (touched.value.includes(card.orderId)) return
    touched.value = [card.orderId, ...touched.value].slice(0, TOUCHED_LIMIT)
    writeLocal(TOUCHED_KEY, JSON.stringify(touched.value))
  }

  /** "Novo" até ser tocado (spec 04, seção 8.2). */
  function isNew(card: StationCard): boolean {
    if (card.ackRequired || touched.value.includes(card.orderId)) return false
    return card.orderId in fresh.value || notStarted(card, stages.value)
  }

  function nextName(line: StationLine): string | undefined {
    return commonNextStageName([line], stages.value)
  }

  /** RN-04.41: tocar numa linha avança só ela; `quantity` para avançar parte (RN-04.24). */
  function advanceLine(line: StationLine, quantity = line.quantity) {
    void itemActions.advance(line, { quantity, toStageName: nextName(line) })
  }

  function backLine(line: StationLine) {
    void itemActions.back(line, previousStageName(stages.value, line.stageId))
  }

  function cancelLine(line: StationLine, quantity: number, reason: string) {
    void itemActions.cancel(line, quantity, reason)
  }

  /** RN-04.39: o botão do cartão avança todas as linhas pendentes (ou só as da etapa filtrada). */
  function advanceCard(card: StationCard, stageId: string | null) {
    const lines = linesToAdvance(card, stageId)
    if (lines.length === 0) return
    const toStageName = commonNextStageName(lines, stages.value)
    void operations.submit({
      path: `/api/v1/orders/${card.orderId}/advance`,
      body: {
        stationId: options.stationId.value,
        ...(stageId ? { stageId } : {}),
        items: lines.map((line) => ({ id: line.id, version: line.version })),
      },
      label: `Avançar o pedido da comanda ${card.tabNumber}${toStageName ? ` para ${toStageName}` : ''}`,
      meta: {
        kind: 'order.advance',
        orderId: card.orderId,
        stationId: options.stationId.value,
        tabId: card.tabId,
        tabNumber: card.tabNumber,
        itemIds: lines.map((line) => line.id),
        ...(toStageName ? { toStageName } : {}),
      },
    })
  }

  /** Menu do cartão: volta uma etapa as linhas pendentes que têm etapa anterior (RN-04.22). */
  function backCard(card: StationCard) {
    for (const line of linesToAdvance(card, null)) {
      if (previousStageName(stages.value, line.stageId)) backLine(line)
    }
  }

  /** Menu do cartão: cancela todas as linhas pendentes com o mesmo motivo (RN-04.25). */
  function cancelCard(card: StationCard, reason: string) {
    for (const line of linesToAdvance(card, null)) cancelLine(line, line.quantity, reason)
  }

  /** RN-04.45: "Ciente" tira o cartão todo cancelado da tela. */
  function acknowledge(card: StationCard) {
    const { [card.orderId]: _gone, ...rest } = cards.value
    cards.value = rest
  }

  function revert(lines: readonly StationLine[]) {
    for (const line of lines) {
      if (line.canceledAt !== null || line.stageIsFinal) continue
      backLine(line)
    }
  }

  /** "Desfazer" do aviso de 5 s: volta as linhas que saíram (RN-04.22). */
  function undoLast() {
    if (!undo.value) return
    revert(undo.value.lines)
    undo.value = null
  }

  /** "Recentes": volta um pedido que saiu desta estação. */
  function revertRecent(entry: RecentOrder): string | null {
    const blocked = entry.lines.filter((line) => line.stageIsFinal || line.canceledAt !== null)
    revert(entry.lines)
    recents.value = recents.value.filter((item) => item.orderId !== entry.orderId)
    return blocked.length
      ? 'Itens já entregues ou cancelados não voltam: só os outros voltaram para cá.'
      : null
  }

  function dismissNotice(orderId: string) {
    const { [orderId]: _done, ...rest } = notices.value
    notices.value = rest
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
    if (undoTimer) clearTimeout(undoTimer)
  })

  return {
    cards,
    stages,
    limits,
    loaded,
    loadError,
    notices,
    looseNotices,
    recents,
    undo,
    load,
    touch,
    isNew,
    advanceLine,
    backLine,
    cancelLine,
    advanceCard,
    backCard,
    cancelCard,
    acknowledge,
    undoLast,
    revertRecent,
    dismissNotice,
  }
}
