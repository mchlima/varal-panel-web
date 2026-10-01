/**
 * Operação da barraca (spec 04): tipos da API, etapas, atraso e textos das telas de balcão,
 * estação e turno. Tudo puro (sem Vue), para ser testado sozinho.
 */
import type { components } from '../api/schema'

type Schemas = components['schemas']
export type Shift = Schemas['Shift']
export type ShiftType = Schemas['ShiftType']
export type AgreementModality = Schemas['AgreementModality']
export type ShiftPendingItems = Schemas['ShiftPendingItems']
export type Tab = Schemas['Tab']
export type TabSummary = Schemas['TabSummary']
export type TabStatus = Schemas['TabStatus']
export type Order = Schemas['Order']
export type OrderItem = Schemas['OrderItem']
export type WorkflowStage = Schemas['WorkflowStage']
export type StationQueue = Schemas['StationQueue']
export type ItemChange = Schemas['ItemChange']
export type OrderItemRejection = Schemas['OrderItemRejection']
export type OrderItemRejectionReason = Schemas['OrderItemRejectionReason']

/** Comandas que aparecem no varal (RN-04.12): as que ainda recebem ação do balcão. */
export const BOARD_STATUSES: readonly TabStatus[] = ['open', 'closing']
export const ALL_TAB_STATUSES: readonly TabStatus[] = [
  'open',
  'closing',
  'paid',
  'on_credit',
  'settled',
  'canceled',
]

export const TAB_STATUS_LABELS: Record<TabStatus, string> = {
  open: 'Aberta',
  closing: 'Fechando',
  paid: 'Paga',
  on_credit: 'No fiado',
  settled: 'Quitada',
  canceled: 'Cancelada',
}

export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  direct_sale: 'Venda direta',
  contracted: 'Turno contratado',
}

export const MODALITY_LABELS: Record<AgreementModality, string> = {
  fixed_fee: 'Valor fixo',
  per_quantity: 'Por quantidade',
  consumption_billed: 'Contratante paga o consumo no final',
  other: 'Outra',
}

/** Limites da spec 04 (RN-04.10, RN-04.16, RN-04.25). */
export const CUSTOMER_NAME_MAX = 40
export const NOTE_MAX = 140
export const REASON_MAX = 140
export const QUANTITY_MAX = 99
export const ORDER_ITEMS_MAX = 50

/**
 * Cor e ícone de cada etapa (spec 08, seção 4): a primeira é "Novo", a anterior à final é
 * "Pronto", a final é "Entregue" (neutro) e as do meio são "Preparando".
 */
export type StageTone = 'new' | 'preparing' | 'ready' | 'delivered'

export function stageIndex(stages: readonly WorkflowStage[], stageId: string): number {
  return stages.findIndex((stage) => stage.id === stageId)
}

export function stageTone(
  stages: readonly WorkflowStage[],
  item: Pick<OrderItem, 'stageId' | 'stageIsFinal'>,
): StageTone {
  if (item.stageIsFinal) return 'delivered'
  const index = stageIndex(stages, item.stageId)
  if (index <= 0) return 'new'
  if (index === stages.length - 2) return 'ready'
  return 'preparing'
}

export function nextStage(stages: readonly WorkflowStage[], stageId: string): WorkflowStage | null {
  const index = stageIndex(stages, stageId)
  return index < 0 ? null : (stages[index + 1] ?? null)
}

export function previousStage(
  stages: readonly WorkflowStage[],
  stageId: string,
): WorkflowStage | null {
  const index = stageIndex(stages, stageId)
  return index <= 0 ? null : (stages[index - 1] ?? null)
}

/**
 * RN-04.21: o balcão registra a entrega dos itens na etapa anterior à final (no template,
 * Pronto → Entregue).
 */
export function isReadyToDeliver(
  stages: readonly WorkflowStage[],
  item: Pick<OrderItem, 'stageId' | 'stageIsFinal' | 'canceledAt'>,
): boolean {
  if (item.canceledAt !== null || item.stageIsFinal) return false
  return nextStage(stages, item.stageId)?.isFinal === true
}

/**
 * Etapas que podem mostrar itens nesta estação (filtro da spec 04, seção 8.2): as fixas nela e
 * as que seguem a estação de preparo do produto.
 */
export function stagesOfStation(
  stages: readonly WorkflowStage[],
  stationId: string,
): WorkflowStage[] {
  return stages.filter(
    (stage) =>
      !stage.isFinal &&
      (stage.target === 'product_station' ||
        (stage.target === 'fixed_station' && stage.stationId === stationId)),
  )
}

/**
 * RN-04.23 (CA-04.11): atrasado depois de `lateAt` (envio + `late_after_minutes`) sem chegar à
 * etapa final. Recalculado com o relógio do aparelho, sem esperar a API.
 */
export function isItemLate(
  item: Pick<OrderItem, 'lateAt' | 'stageIsFinal' | 'canceledAt'>,
  now: number,
): boolean {
  if (item.lateAt === null || item.stageIsFinal || item.canceledAt !== null) return false
  return now >= Date.parse(item.lateAt)
}

/** Minutos inteiros desde `iso` (nunca negativo). */
export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
}

/** "agora", "há 1 min", "há 12 min", "há 1 h 05 min". */
export function elapsedLabel(iso: string, now: number): string {
  const minutes = minutesSince(iso, now)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `há ${hours} h ${String(minutes % 60).padStart(2, '0')} min`
}

/** "12 · Dona Marta" (RN-04.10). */
export function tabLabel(tab: { number: number; customerName: string }): string {
  return `${tab.number} · ${tab.customerName}`
}

/** "1 item", "3 itens". */
export function itemsLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} itens`
}

/** Valor da linha (spec 04, seção 6): `(preço unitário + acréscimos) × quantidade`. */
export function itemTotalCents(item: {
  unitPriceCents: number
  quantity: number
  modifiers: readonly { priceDeltaCents: number }[]
}): number {
  const deltas = item.modifiers.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0)
  return (item.unitPriceCents + deltas) * item.quantity
}

/** RN-04.14: subtotal = soma dos itens não cancelados. */
export function activeSubtotalCents(items: readonly OrderItem[]): number {
  return items
    .filter((item) => item.canceledAt === null)
    .reduce((sum, item) => sum + itemTotalCents(item), 0)
}

/** Motivo de recusa de um item do pedido (`ORDER_REJECTED`, RN-04.17), para o balcão. */
export function rejectionMessage(reason: OrderItemRejectionReason, groupName?: string): string {
  switch (reason) {
    case 'sold_out':
      return 'Esgotado: tire do pedido.'
    case 'product_inactive':
      return 'Produto fora do cardápio agora: tire do pedido.'
    case 'product_unavailable':
      return 'Produto não existe mais nesta unidade: tire do pedido.'
    case 'modifier_required':
      return groupName ? `Falta escolher: ${groupName}.` : 'Falta uma escolha obrigatória.'
    case 'too_many_modifiers':
      return groupName ? `Escolhas demais em: ${groupName}.` : 'Escolhas demais num grupo.'
    case 'invalid_modifier':
      return 'Uma das opções escolhidas não está mais disponível: refaça as escolhas.'
  }
}

/** `details` de `SHIFT_HAS_PENDING_ITEMS` (RN-04.07, CA-04.09), lido com cuidado. */
export function pendingItemsOf(details: Record<string, unknown>): ShiftPendingItems {
  const tabs = Array.isArray(details.tabs) ? (details.tabs as ShiftPendingItems['tabs']) : []
  const cashRegisters = Array.isArray(details.cashRegisters)
    ? (details.cashRegisters as ShiftPendingItems['cashRegisters'])
    : []
  return { tabs, cashRegisters }
}

/** `details.items` de `ORDER_REJECTED`. */
export function rejectionsOf(details: Record<string, unknown> | undefined): OrderItemRejection[] {
  return Array.isArray(details?.items) ? (details.items as OrderItemRejection[]) : []
}

/** `details.item` de `ITEM_CHANGED` (CA-04.05): o estado atual do item. */
export function changedItemOf(details: Record<string, unknown> | undefined): OrderItem | null {
  const item = details?.item
  return typeof item === 'object' && item !== null && 'id' in item ? (item as OrderItem) : null
}

/** Recusas de mudança de item que a tela explica no próprio cartão (CA-04.05). */
export const ITEM_CONFLICT_CODES = [
  'ITEM_CHANGED',
  'ITEM_CANCELED',
  'ITEM_IN_FINAL_STAGE',
  'NO_PREVIOUS_STAGE',
] as const

/**
 * Explica, no cartão, por que a ação deste aparelho não foi aplicada. `current` é o estado atual
 * do item (`details.item` do `ITEM_CHANGED`), quando veio.
 */
export function itemConflictMessage(code: string, current: OrderItem | null): string | null {
  switch (code) {
    case 'ITEM_CHANGED':
      if (current?.canceledAt)
        return 'Outro aparelho cancelou este item. Sua ação não foi aplicada.'
      return current
        ? `Outro aparelho mexeu neste item antes: agora está em ${current.stageName}${current.quantity > 0 ? ` (${current.quantity})` : ''}. Sua ação não foi aplicada.`
        : 'Outro aparelho mexeu neste item antes. Sua ação não foi aplicada.'
    case 'ITEM_CANCELED':
      return 'Este item já foi cancelado. Sua ação não foi aplicada.'
    case 'ITEM_IN_FINAL_STAGE':
      return 'Este item já está na etapa final. Sua ação não foi aplicada.'
    case 'NO_PREVIOUS_STAGE':
      return 'Este item já está na primeira etapa. Sua ação não foi aplicada.'
    default:
      return null
  }
}
