/**
 * Montagem do pedido no balcão (spec 04, seção 8.1; RN-04.16, RN-04.17; RN-03.13; CA-03.06).
 * Regras puras: escolhas de modificadores com mínimo e máximo, preço da tabela efetiva (RN-04.32),
 * total do carrinho e o corpo do `POST /tabs/{id}/orders`.
 */
import type { components } from '../api/schema'
import { NOTE_MAX, ORDER_ITEMS_MAX, QUANTITY_MAX, type OrderItemRejection } from './operation'

type Schemas = components['schemas']
export type MenuProduct = Schemas['MenuProduct']
export type ModifierGroup = Schemas['ModifierGroup']
export type CreateOrderBody = Schemas['CreateOrderRequestInput']

/** Escolhas de um produto: id do grupo → ids das opções, na ordem em que foram tocadas. */
export type Selection = Record<string, string[]>

export interface CartModifier {
  id: string
  groupId: string
  groupName: string
  name: string
  priceDeltaCents: number
}

export interface CartLine {
  /** Identifica a linha no carrinho (produto + escolhas + observação). */
  key: string
  productId: string
  productName: string
  /** Preço unitário mostrado: o da tabela efetiva (RN-04.33); a API grava o do envio. */
  unitPriceCents: number
  quantity: number
  modifiers: CartModifier[]
  note: string
}

/** Grupos que o balcão mostra: só opções ativas, na ordem do cardápio. */
export function visibleGroups(product: Pick<MenuProduct, 'modifierGroups'>): ModifierGroup[] {
  return [...product.modifierGroups]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({
      ...group,
      modifiers: [...group.modifiers]
        .filter((modifier) => modifier.active)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .filter((group) => group.modifiers.length > 0 || group.minChoices > 0)
}

/** O produto pede a folha de opções (tem grupo com opção ativa ou obrigatório). */
export function needsOptions(product: Pick<MenuProduct, 'modifierGroups'>): boolean {
  return visibleGroups(product).length > 0
}

/**
 * RN-04.32, RN-04.33: o preço que um item novo usa agora, já calculado pela API no cardápio
 * (tabela efetiva da unidade, ou o preço normal quando o produto não tem preço nela).
 */
export function effectivePriceCents(
  product: Pick<MenuProduct, 'priceCents'> & { effectivePriceCents?: number },
): number {
  return product.effectivePriceCents ?? product.priceCents
}

/**
 * Toca numa opção. Grupo de máximo 1 funciona como escolha única (troca a opção); nos outros,
 * marca e desmarca, sem passar do máximo (devolve a seleção igual se já estiver no limite).
 */
export function toggleModifier(
  selection: Selection,
  group: Pick<ModifierGroup, 'id' | 'maxChoices'>,
  modifierId: string,
): Selection {
  const current = selection[group.id] ?? []
  if (current.includes(modifierId)) {
    return { ...selection, [group.id]: current.filter((id) => id !== modifierId) }
  }
  if (group.maxChoices === 1) return { ...selection, [group.id]: [modifierId] }
  if (current.length >= group.maxChoices) return selection
  return { ...selection, [group.id]: [...current, modifierId] }
}

export interface GroupIssue {
  groupId: string
  message: string
}

/** RN-03.13 / CA-03.06: o que falta (ou sobra) em cada grupo. Vazio = pode adicionar. */
export function selectionIssues(
  groups: readonly ModifierGroup[],
  selection: Selection,
): GroupIssue[] {
  const issues: GroupIssue[] = []
  for (const group of groups) {
    const chosen = (selection[group.id] ?? []).length
    if (chosen < group.minChoices) {
      issues.push({
        groupId: group.id,
        message:
          group.minChoices === 1
            ? `Escolha uma opção em ${group.name}.`
            : `Escolha pelo menos ${group.minChoices} em ${group.name}.`,
      })
    } else if (chosen > group.maxChoices) {
      issues.push({
        groupId: group.id,
        message: `Escolha no máximo ${group.maxChoices} em ${group.name}.`,
      })
    }
  }
  return issues
}

/** Seleção inicial: vazia (nenhuma escolha é presumida pelo balcão). */
export function emptySelection(): Selection {
  return {}
}

/** Opções escolhidas, na ordem dos grupos e das opções do cardápio. */
export function chosenModifiers(
  groups: readonly ModifierGroup[],
  selection: Selection,
): CartModifier[] {
  const result: CartModifier[] = []
  for (const group of groups) {
    const chosen = selection[group.id] ?? []
    for (const modifier of group.modifiers) {
      if (!chosen.includes(modifier.id)) continue
      result.push({
        id: modifier.id,
        groupId: group.id,
        groupName: group.name,
        name: modifier.name,
        priceDeltaCents: modifier.priceDeltaCents,
      })
    }
  }
  return result
}

export function normalizeNote(note: string): string {
  return note.trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX)
}

export function lineKey(
  productId: string,
  modifiers: readonly { id: string }[],
  note: string,
): string {
  const ids = modifiers
    .map((modifier) => modifier.id)
    .sort()
    .join(',')
  return `${productId}|${ids}|${normalizeNote(note)}`
}

export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1
  return Math.min(QUANTITY_MAX, Math.max(1, Math.trunc(quantity)))
}

export function buildLine(input: {
  product: Pick<MenuProduct, 'id' | 'name' | 'priceCents'> & { effectivePriceCents?: number }
  modifiers: CartModifier[]
  quantity: number
  note: string
}): CartLine {
  const note = normalizeNote(input.note)
  return {
    key: lineKey(input.product.id, input.modifiers, note),
    productId: input.product.id,
    productName: input.product.name,
    unitPriceCents: effectivePriceCents(input.product),
    quantity: clampQuantity(input.quantity),
    modifiers: input.modifiers,
    note,
  }
}

/** Junta com a linha igual (mesmo produto, escolhas e observação) ou acrescenta no fim. */
export function addLine(lines: readonly CartLine[], line: CartLine): CartLine[] {
  const index = lines.findIndex((existing) => existing.key === line.key)
  if (index < 0) return [...lines, line]
  return lines.map((existing, i) =>
    i === index
      ? { ...existing, quantity: clampQuantity(existing.quantity + line.quantity) }
      : existing,
  )
}

export function setLineQuantity(
  lines: readonly CartLine[],
  key: string,
  quantity: number,
): CartLine[] {
  if (quantity <= 0) return lines.filter((line) => line.key !== key)
  return lines.map((line) =>
    line.key === key ? { ...line, quantity: clampQuantity(quantity) } : line,
  )
}

/** Valor de uma linha: `(preço unitário + acréscimos) × quantidade` (spec 04, seção 6). */
export function lineTotalCents(
  line: Pick<CartLine, 'unitPriceCents' | 'quantity' | 'modifiers'>,
): number {
  const deltas = line.modifiers.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0)
  return (line.unitPriceCents + deltas) * line.quantity
}

export function cartTotalCents(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0)
}

export function cartUnits(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}

/** Preço exibido de uma linha com as escolhas atuais, antes de adicionar (folha de opções). */
export function previewTotalCents(
  unitPriceCents: number,
  modifiers: readonly CartModifier[],
  quantity: number,
): number {
  return lineTotalCents({
    unitPriceCents,
    modifiers: [...modifiers],
    quantity: clampQuantity(quantity),
  })
}

/** RN-04.16: de 1 a 50 itens. */
export function cartIssue(lines: readonly CartLine[]): string | null {
  if (lines.length === 0) return 'Adicione pelo menos um item.'
  if (lines.length > ORDER_ITEMS_MAX) return `Um pedido tem no máximo ${ORDER_ITEMS_MAX} itens.`
  return null
}

export function toOrderBody(lines: readonly CartLine[]): CreateOrderBody {
  return {
    items: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      modifierIds: line.modifiers.map((modifier) => modifier.id),
      ...(line.note ? { note: line.note } : {}),
    })),
  }
}

/**
 * `ORDER_REJECTED` (RN-04.17, CA-04.06): o `index` aponta o item no corpo enviado, na mesma ordem
 * das linhas do carrinho. Devolve as recusas por chave de linha.
 */
export function rejectionsByLine(
  lines: readonly Pick<CartLine, 'key'>[],
  rejections: readonly OrderItemRejection[],
): Record<string, OrderItemRejection[]> {
  const result: Record<string, OrderItemRejection[]> = {}
  for (const rejection of rejections) {
    const line = lines[rejection.index]
    if (!line) continue
    ;(result[line.key] ??= []).push(rejection)
  }
  return result
}

/** Linhas cujo produto está esgotado ou fora do cardápio agora (bloqueiam o envio). */
export function unavailableLines(
  lines: readonly CartLine[],
  findProduct: (id: string) => Pick<MenuProduct, 'active' | 'soldOut'> | null,
): string[] {
  return lines
    .filter((line) => {
      const product = findProduct(line.productId)
      return !product || !product.active || product.soldOut
    })
    .map((line) => line.key)
}
