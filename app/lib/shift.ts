/**
 * Turno (spec 04, seção 3): formulário de abertura, acordo do turno contratado (RN-04.05) e
 * tabela de preços (RN-04.06). Regras puras, testadas sozinhas.
 */
import type { components } from '../api/schema'
import { centsToInput, parseReais } from './money'
import type { AgreementModality, ShiftType, TabSummary } from './operation'
import { parseInteger } from './setup'

type Schemas = components['schemas']
export type OpenShiftBody = Schemas['OpenShiftRequestInput']
export type ShiftPriceInput = Schemas['ShiftPriceInput']

export interface AgreementForm {
  contractorName: string
  modality: AgreementModality
  agreedAmount: string
  agreedQuantity: string
  limits: string
  notes: string
}

export function emptyAgreement(): AgreementForm {
  return {
    contractorName: '',
    modality: 'fixed_fee',
    agreedAmount: '',
    agreedQuantity: '',
    limits: '',
    notes: '',
  }
}

/** Preços digitados (`productId` → reais) → tabela da API; erros por produto. */
export function parsePrices(input: Record<string, string>): {
  prices: ShiftPriceInput[]
  errors: Record<string, string>
} {
  const prices: ShiftPriceInput[] = []
  const errors: Record<string, string> = {}
  for (const [productId, raw] of Object.entries(input)) {
    if (!raw.trim()) continue
    const cents = parseReais(raw)
    if (cents === null) errors[productId] = 'Valor inválido.'
    else prices.push({ productId, priceCents: cents })
  }
  return { prices, errors }
}

/** Tabela da API → campos em reais, para editar. */
export function pricesToInput(prices: readonly ShiftPriceInput[]): Record<string, string> {
  return Object.fromEntries(
    prices.map((price) => [price.productId, centsToInput(price.priceCents)]),
  )
}

export type ShiftFormErrors = Partial<
  Record<'contractorName' | 'agreedAmount' | 'agreedQuantity' | 'prices', string>
> & { priceByProduct?: Record<string, string> }

/** Monta o corpo do `POST /units/{id}/shifts` ou devolve os erros do formulário. */
export function buildOpenShift(
  type: ShiftType,
  agreement: AgreementForm,
  priceInput: Record<string, string>,
): { body: OpenShiftBody | null; errors: ShiftFormErrors } {
  const errors: ShiftFormErrors = {}
  const { prices, errors: priceErrors } = parsePrices(priceInput)
  if (Object.keys(priceErrors).length) {
    errors.priceByProduct = priceErrors
    errors.prices = 'Confira os preços marcados.'
  }
  let body: OpenShiftBody | null = null
  if (type === 'contracted') {
    // RN-04.05: acordo obrigatório no turno contratado; valor e quantidade são opcionais.
    const name = agreement.contractorName.trim()
    if (!name) errors.contractorName = 'Informe o nome do contratante.'
    const amount = agreement.agreedAmount.trim() ? parseReais(agreement.agreedAmount) : null
    if (agreement.agreedAmount.trim() && amount === null) errors.agreedAmount = 'Valor inválido.'
    const quantity = agreement.agreedQuantity.trim() ? parseInteger(agreement.agreedQuantity) : null
    if (agreement.agreedQuantity.trim() && (quantity === null || quantity < 1)) {
      errors.agreedQuantity = 'Use um número inteiro maior que zero.'
    }
    if (Object.keys(errors).length === 0) {
      body = {
        type,
        prices,
        agreement: {
          contractorName: name,
          modality: agreement.modality,
          agreedAmountCents: amount,
          agreedQuantity: quantity,
          limits: agreement.limits.trim() || null,
          notes: agreement.notes.trim() || null,
        },
      }
    }
  } else if (Object.keys(errors).length === 0) {
    body = { type, prices, agreement: null }
  }
  return { body, errors }
}

export interface ShiftSummary {
  open: number
  closing: number
  closed: number
  /** Soma das comandas não canceladas (RN-04.14). */
  totalCents: number
  items: number
}

export function summarizeTabs(tabs: readonly TabSummary[]): ShiftSummary {
  const summary: ShiftSummary = { open: 0, closing: 0, closed: 0, totalCents: 0, items: 0 }
  for (const tab of tabs) {
    if (tab.status === 'open') summary.open += 1
    else if (tab.status === 'closing') summary.closing += 1
    else if (tab.status !== 'canceled') summary.closed += 1
    if (tab.status !== 'canceled') {
      summary.totalCents += tab.totalCents
      summary.items += tab.itemCount
    }
  }
  return summary
}
