/**
 * Tabelas de preço (spec 03, seção 5.3): regras puras do nome (RN-03.20) e dos preços digitados
 * por tabela (RN-03.21, RN-03.22). Sempre em centavos inteiros; campo vazio = preço normal.
 */
import { centsToInput, parseReais } from './money'
import { NORMAL_PRICE_LIST_NAME } from './operation'

/** RN-03.20: nome de 1 a 30 caracteres. */
export const PRICE_LIST_NAME_MAX = 30

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

/**
 * Problema do nome da tabela, ou `null`. "Normal" é reservado para o preço normal (CA-03.10) e o
 * nome não se repete na unidade, sem diferenciar maiúsculas (a API confere de novo).
 */
export function priceListNameError(
  name: string,
  others: readonly { id: string; name: string }[] = [],
  selfId: string | null = null,
): string | null {
  const clean = name.trim()
  if (!clean) return 'Dê um nome à tabela (ex.: Evento, Casamento).'
  if (clean.length > PRICE_LIST_NAME_MAX) return `Use até ${PRICE_LIST_NAME_MAX} caracteres.`
  if (normalizeName(clean) === normalizeName(NORMAL_PRICE_LIST_NAME)) {
    return '"Normal" é o preço de sempre do cardápio. Escolha outro nome.'
  }
  if (
    others.some((list) => list.id !== selfId && normalizeName(list.name) === normalizeName(clean))
  ) {
    return 'Já existe uma tabela com esse nome.'
  }
  return null
}

/** Preços salvos (`productId`/`priceListId` → centavos) em campos de reais para editar. */
export function pricesToInput(prices: Record<string, number>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(prices).map(([key, cents]) => [key, centsToInput(cents)]),
  )
}

export interface PriceChange {
  /** Produto (na tela da tabela) ou tabela (no editor do produto). */
  key: string
  /** `null` remove o preço: volta ao preço normal (RN-03.21). */
  priceCents: number | null
}

/**
 * Compara o que foi digitado com o que está salvo e devolve só o que mudou, para enviar de uma
 * vez (RN-03.22). Campo vazio = preço normal (remove da tabela); valor inválido vira erro do campo.
 */
export function priceChanges(
  saved: Record<string, number>,
  input: Record<string, string>,
): { changes: PriceChange[]; errors: Record<string, string> } {
  const changes: PriceChange[] = []
  const errors: Record<string, string> = {}
  const keys = new Set([...Object.keys(saved), ...Object.keys(input)])
  for (const key of keys) {
    const raw = (input[key] ?? '').trim()
    const current = saved[key]
    if (!raw) {
      if (current !== undefined) changes.push({ key, priceCents: null })
      continue
    }
    const cents = parseReais(raw)
    if (cents === null) {
      errors[key] = 'Valor inválido (ex.: 15,00).'
      continue
    }
    if (cents !== current) changes.push({ key, priceCents: cents })
  }
  return { changes, errors }
}

/** "1 produto com preço", "3 produtos com preço", "Nenhum produto com preço ainda". */
export function productCountLabel(count: number): string {
  if (count === 0) return 'Nenhum produto com preço ainda'
  return count === 1 ? '1 produto com preço' : `${count} produtos com preço`
}
