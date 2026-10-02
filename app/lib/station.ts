/**
 * Tela da estação no formato KDS (spec 04, seções 5.2 e 8.2): um pedido, um cartão (RN-04.40 a
 * RN-04.45), níveis de tempo (RN-04.46), contadores e filtros. Regras puras, sem Vue, testadas
 * sozinhas. A fila da API (`GET /stations/{id}/queue`) é a fonte da verdade; aqui ficam só as
 * regras para aplicar os eventos na hora, antes da recarga confirmar.
 */
import {
  nextStage,
  previousStage,
  timeLevel,
  type Order,
  type OrderItem,
  type StationLine,
  type StationLineState,
  type StationOrder,
  type TimeLevel,
  type WorkflowStage,
} from './operation'

export interface StationLimits {
  attentionAfterMinutes: number
  lateAfterMinutes: number
}

/** Cartão na tela: o pedido da fila e, se tudo foi cancelado, o "Ciente" pendente (RN-04.45). */
export interface StationCard extends StationOrder {
  /** Todas as linhas pendentes foram canceladas: o cartão fica até alguém tocar em "Ciente". */
  ackRequired: boolean
}

export type CardMap = Record<string, StationCard>

/** RN-04.41: pendente quando está numa etapa desta estação; feita quando saiu; ou cancelada. */
export function lineState(
  item: Pick<OrderItem, 'canceledAt' | 'stationId'>,
  stationId: string,
): StationLineState {
  if (item.canceledAt !== null) return 'canceled'
  return item.stationId === stationId ? 'pending' : 'done'
}

export function toLine(item: OrderItem, stationId: string): StationLine {
  return { ...item, state: lineState(item, stationId) }
}

export function pendingLines(card: Pick<StationOrder, 'lines'>): StationLine[] {
  return card.lines.filter((line) => line.state === 'pending')
}

export function fromOrder(order: StationOrder): StationCard {
  return { ...order, ackRequired: false }
}

/** Ordem da grade: pedido mais antigo primeiro (canto superior esquerdo, CA-04.18). */
export function sortCards<T extends Pick<StationOrder, 'sentAt' | 'orderId'>>(cards: T[]): T[] {
  return [...cards].sort(
    (a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.orderId.localeCompare(b.orderId),
  )
}

export interface ApplyResult {
  changed: boolean
  /** Cartão novo nesta estação (som, vibração e "Novo"). */
  arrived: boolean
  /** Uma linha pendente foi cancelada aqui (som e vibração, RN-04.45). */
  canceledHere: boolean
  /** O cartão saiu da tela porque todas as linhas saíram da estação (RN-04.42). */
  left: StationCard | null
}

const NOTHING: ApplyResult = { changed: false, arrived: false, canceledHere: false, left: null }

/**
 * Aplica uma linha vinda de evento ou de resposta de ação (RN-04.40 a RN-04.45). Ignora versão
 * menor ou igual à conhecida. Linha nova de divisão (RN-04.24, RN-04.26) entra logo depois da
 * original. Quando não sobra linha pendente: se a última mudança foi cancelamento, o cartão fica
 * marcado para o "Ciente"; senão, sai.
 */
export function applyItem(cards: CardMap, item: OrderItem, stationId: string): ApplyResult {
  const line = toLine(item, stationId)
  const card = cards[item.orderId]
  if (!card) {
    if (line.state !== 'pending') return NOTHING
    cards[item.orderId] = {
      orderId: item.orderId,
      tabId: item.tabId,
      tabNumber: item.tabNumber,
      customerName: item.customerName,
      tabMode: 'open_tab',
      numberInTab: item.orderNumberInTab,
      isAdditional: item.orderNumberInTab > 1,
      sentAt: item.sentAt,
      attentionAt: item.sentAt,
      lateAt: item.sentAt,
      otherStationsQuantity: 0,
      lines: [line],
      ackRequired: false,
    }
    return { ...NOTHING, changed: true, arrived: true }
  }
  const index = card.lines.findIndex((existing) => existing.id === item.id)
  let before: StationLineState | null = null
  if (index >= 0) {
    if (item.version <= card.lines[index]!.version) return NOTHING
    before = card.lines[index]!.state
    card.lines.splice(index, 1, line)
  } else {
    const origin = item.splitFromId
      ? card.lines.findIndex((existing) => existing.id === item.splitFromId)
      : -1
    if (origin >= 0) card.lines.splice(origin + 1, 0, line)
    else if (line.state === 'pending') card.lines.push(line)
    else return NOTHING
  }
  const canceledHere = line.state === 'canceled' && before === 'pending'
  if (pendingLines(card).length === 0) {
    if (canceledHere || card.ackRequired) {
      card.ackRequired = true
    } else {
      Reflect.deleteProperty(cards, item.orderId)
      return { changed: true, arrived: false, canceledHere, left: card }
    }
  }
  return { changed: true, arrived: false, canceledHere, left: null }
}

/**
 * `order.created`: o pedido inteiro (sala da unidade) ou só as linhas desta estação (sala da
 * estação); pode chegar das duas formas. Linhas de outras estações só contam no "+ N itens em
 * outra estação" (RN-04.43).
 */
export function applyOrder(cards: CardMap, order: Order, stationId: string): ApplyResult {
  const here = order.items.filter(
    (item) => item.stationId === stationId && item.canceledAt === null,
  )
  const other = order.items
    .filter((item) => item.canceledAt === null && item.stationId && item.stationId !== stationId)
    .reduce((sum, item) => sum + item.quantity, 0)
  let result: ApplyResult = NOTHING
  for (const item of here) {
    const applied = applyItem(cards, item, stationId)
    result = {
      changed: result.changed || applied.changed,
      arrived: result.arrived || applied.arrived,
      canceledHere: false,
      left: null,
    }
  }
  const card = cards[order.id]
  if (card) {
    card.customerName = order.customerName
    card.numberInTab = order.numberInTab
    card.isAdditional = order.numberInTab > 1
    card.otherStationsQuantity = Math.max(card.otherStationsQuantity, other)
  }
  return result
}

export interface ReloadResult {
  cards: CardMap
  /** Cartões que estavam na tela e saíram (todas as linhas feitas): vão para "Recentes". */
  left: StationCard[]
}

/**
 * Troca o estado pelo da API (RN-01.05). Cartões que esperam o "Ciente" continuam, porque a API
 * não devolve mais um pedido sem linha pendente (RN-04.45).
 */
export function mergeReload(previous: CardMap, orders: readonly StationOrder[]): ReloadResult {
  const cards: CardMap = {}
  for (const order of orders) cards[order.orderId] = fromOrder(order)
  const left: StationCard[] = []
  for (const card of Object.values(previous)) {
    if (card.orderId in cards) continue
    if (card.ackRequired) cards[card.orderId] = card
    else left.push(card)
  }
  return { cards, left }
}

/** RN-04.46: nível de tempo do cartão, pelo envio do pedido e os limites da estação. */
export function cardLevel(
  card: Pick<StationOrder, 'sentAt'>,
  limits: StationLimits,
  now: number,
): TimeLevel {
  return timeLevel(card.sentAt, limits, now)
}

/** Todas as linhas pendentes na primeira etapa do fluxo: o preparo ainda não começou. */
export function notStarted(card: Pick<StationOrder, 'lines'>, stages: readonly WorkflowStage[]) {
  const first = stages[0]?.id
  const pending = pendingLines(card)
  return pending.length > 0 && pending.every((line) => line.stageId === first)
}

/** Linhas que o botão do cartão avança: as pendentes, ou só as da etapa filtrada (RN-04.39). */
export function linesToAdvance(
  card: Pick<StationOrder, 'lines'>,
  stageId: string | null,
): StationLine[] {
  return pendingLines(card).filter((line) => !stageId || line.stageId === stageId)
}

/**
 * Rótulo do botão do cartão (spec 04, seção 8.2): "Começar" quando todas as linhas estão na
 * primeira etapa; o nome da próxima etapa quando todas vão para a mesma ("Pronto"); senão,
 * "Avançar tudo".
 */
export function advanceLabel(
  lines: readonly Pick<StationLine, 'stageId'>[],
  stages: readonly WorkflowStage[],
): string {
  if (lines.length === 0) return 'Avançar tudo'
  const targets = new Set(lines.map((line) => nextStage(stages, line.stageId)?.id ?? null))
  if (targets.size !== 1) return 'Avançar tudo'
  const target = nextStage(stages, lines[0]!.stageId)
  if (!target) return 'Avançar tudo'
  if (lines.every((line) => line.stageId === stages[0]?.id) && !target.isFinal) return 'Começar'
  return target.name
}

/** Nome da etapa para onde as linhas vão, quando é uma só (texto de pendência e de desfazer). */
export function commonNextStageName(
  lines: readonly Pick<StationLine, 'stageId'>[],
  stages: readonly WorkflowStage[],
): string | undefined {
  const names = new Set(lines.map((line) => nextStage(stages, line.stageId)?.name))
  return names.size === 1 ? [...names][0] : undefined
}

export function previousStageName(
  stages: readonly WorkflowStage[],
  stageId: string,
): string | undefined {
  return previousStage(stages, stageId)?.name
}

export type CardFilter =
  | { kind: 'all' }
  | { kind: 'new' }
  | { kind: 'stage'; stageId: string }
  | { kind: 'level'; level: Exclude<TimeLevel, 'normal'> }

export interface CounterEntry {
  key: string
  label: string
  count: number
  filter: CardFilter
}

export interface CardContext {
  limits: StationLimits
  now: number
  isNew: (card: StationCard) => boolean
}

export function matchesFilter(card: StationCard, filter: CardFilter, context: CardContext) {
  switch (filter.kind) {
    case 'all':
      return true
    case 'new':
      return context.isNew(card)
    case 'stage':
      return pendingLines(card).some((line) => line.stageId === filter.stageId)
    case 'level':
      return cardLevel(card, context.limits, context.now) === filter.level
  }
}

/**
 * Contadores do topo (spec 04, seção 8.2): "Novos 3 · Preparando 5 · Atenção 2 · Atrasados 1",
 * que também funcionam como filtro. Etapas sem cartão e níveis zerados não aparecem, exceto
 * "Todos".
 */
export function counters(
  cards: readonly StationCard[],
  stationStages: readonly WorkflowStage[],
  context: CardContext,
): CounterEntry[] {
  const active = cards.filter((card) => !card.ackRequired)
  const count = (filter: CardFilter) =>
    active.filter((card) => matchesFilter(card, filter, context)).length
  const entries: CounterEntry[] = [
    { key: 'all', label: 'Todos', count: active.length, filter: { kind: 'all' } },
  ]
  const fresh = count({ kind: 'new' })
  if (fresh > 0) entries.push({ key: 'new', label: 'Novos', count: fresh, filter: { kind: 'new' } })
  if (stationStages.length > 1) {
    for (const stage of stationStages) {
      const filter: CardFilter = { kind: 'stage', stageId: stage.id }
      entries.push({ key: `stage:${stage.id}`, label: stage.name, count: count(filter), filter })
    }
  }
  const attention = count({ kind: 'level', level: 'attention' })
  if (attention > 0) {
    entries.push({
      key: 'attention',
      label: 'Atenção',
      count: attention,
      filter: { kind: 'level', level: 'attention' },
    })
  }
  const late = count({ kind: 'level', level: 'late' })
  if (late > 0) {
    entries.push({
      key: 'late',
      label: 'Atrasados',
      count: late,
      filter: { kind: 'level', level: 'late' },
    })
  }
  return entries
}

/** Tamanho do cartão (spec 04, seção 8.2): largura fixa da coluna em telas maiores. */
export type CardSize = 'small' | 'medium' | 'large'
export const CARD_WIDTHS: Record<CardSize, number> = { small: 240, medium: 300, large: 380 }
export const CARD_SIZE_LABELS: Record<CardSize, string> = {
  small: 'Pequeno',
  medium: 'Médio',
  large: 'Grande',
}

/** Pedido que saiu desta estação, para "Recentes" e "Desfazer" (spec 04, seção 8.2). */
export interface RecentOrder {
  orderId: string
  tabNumber: number
  customerName: string
  numberInTab: number
  leftAt: number
  /** Linhas que saíram daqui, com a versão mais nova conhecida (para voltar, RN-04.22). */
  lines: StationLine[]
}

export const RECENT_LIMIT = 10

export function recentFrom(card: StationCard, now: number): RecentOrder {
  return {
    orderId: card.orderId,
    tabNumber: card.tabNumber,
    customerName: card.customerName,
    numberInTab: card.numberInTab,
    leftAt: now,
    lines: card.lines.filter((line) => line.state === 'done'),
  }
}

/** Acrescenta no topo, sem repetir o pedido, guardando só os 10 últimos. */
export function pushRecent(list: readonly RecentOrder[], entry: RecentOrder): RecentOrder[] {
  return [entry, ...list.filter((item) => item.orderId !== entry.orderId)].slice(0, RECENT_LIMIT)
}

/** Atualiza a versão das linhas de "Recentes" com um evento (unidade inteira). */
export function refreshRecent(list: RecentOrder[], item: OrderItem, stationId: string): boolean {
  let changed = false
  for (const entry of list) {
    const index = entry.lines.findIndex((line) => line.id === item.id)
    if (index >= 0 && item.version > entry.lines[index]!.version) {
      entry.lines.splice(index, 1, toLine(item, stationId))
      changed = true
    }
  }
  return changed
}

/** Limites de tempo da estação (spec 03, seção 3: atraso de 1 a 240 minutos). */
export const LATE_LIMIT_MAX = 240

/**
 * RN-03.25 (CA-03.12): atraso de 1 a 240 minutos e atenção de 1 até o atraso − 1 (senão a API
 * recusa com `INVALID_TIME_LIMITS`). Devolve a mensagem do problema, ou `null`.
 */
export function timeLimitsError(attention: number, late: number): string | null {
  if (!Number.isInteger(attention) || !Number.isInteger(late)) return 'Use minutos inteiros.'
  if (late < 1 || late > LATE_LIMIT_MAX) return `O atraso vai de 1 a ${LATE_LIMIT_MAX} minutos.`
  if (attention < 1) return 'A atenção precisa ser de pelo menos 1 minuto.'
  if (attention >= late) return 'A atenção precisa vir antes do atraso (um número menor).'
  return null
}

/** Padrão de uma estação nova (RN-03.25): atraso da unidade e atenção na metade, para baixo. */
export function defaultLimits(unitLateAfterMinutes: number): StationLimits {
  return {
    lateAfterMinutes: unitLateAfterMinutes,
    attentionAfterMinutes: Math.max(1, Math.floor(unitLateAfterMinutes / 2)),
  }
}
