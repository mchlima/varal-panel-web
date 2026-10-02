/**
 * Eventos contratados (spec 04, seção 3.3): formulário do cadastro (RN-04.05), ordem da lista
 * (spec 04, seção 8.3) e quem pode fazer o quê (RN-04.34, RN-04.37). Regras puras, testadas
 * sozinhas.
 */
import type { components } from '../api/schema'
import { centsToInput, formatCents, parseReais } from './money'
import { longDay, type AgreementModality, type ContractedEvent } from './operation'
import { parseInteger } from './setup'

type Schemas = components['schemas']
export type CreateEventBody = Schemas['CreateContractedEventRequestInput']

/** RN-04.05 e limites do contrato da API. */
export const CONTRACTOR_NAME_MAX = 60
export const EVENT_LIMITS_MAX = 200
export const EVENT_NOTES_MAX = 500
export const AGREED_QUANTITY_MAX = 1_000_000

export const MODALITY_HINTS: Record<AgreementModality, string> = {
  fixed_fee: 'O contratante paga um valor combinado, não importa o consumo.',
  per_quantity: 'O valor depende da quantidade (ex.: por espeto ou por convidado).',
  consumption_billed:
    'Os pedidos vão numa comanda com o nome do contratante, pendurada no fiado no fim.',
  other: 'Outro tipo de acerto: descreva na observação.',
}

export interface EventForm {
  contractorName: string
  startsOn: string
  endsOn: string
  modality: AgreementModality
  agreedAmount: string
  agreedQuantity: string
  limits: string
  notes: string
  /** `''` = "Normal". */
  priceListId: string
}

export type EventFormErrors = Partial<Record<keyof EventForm, string>>

export function emptyEventForm(startsOn = ''): EventForm {
  return {
    contractorName: '',
    startsOn,
    endsOn: '',
    modality: 'fixed_fee',
    agreedAmount: '',
    agreedQuantity: '',
    limits: '',
    notes: '',
    priceListId: '',
  }
}

export function eventToForm(event: ContractedEvent): EventForm {
  return {
    contractorName: event.contractorName,
    startsOn: event.startsOn,
    endsOn: event.endsOn ?? '',
    modality: event.modality,
    agreedAmount: event.agreedAmountCents === null ? '' : centsToInput(event.agreedAmountCents),
    agreedQuantity: event.agreedQuantity === null ? '' : String(event.agreedQuantity),
    limits: event.limits ?? '',
    notes: event.notes ?? '',
    priceListId: event.priceList?.id ?? '',
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Monta o corpo do cadastro (e da edição) ou devolve os erros por campo (RN-04.05). */
export function buildEventBody(form: EventForm): {
  body: CreateEventBody | null
  errors: EventFormErrors
} {
  const errors: EventFormErrors = {}
  const name = form.contractorName.trim().replace(/\s+/g, ' ')
  if (!name) errors.contractorName = 'Informe quem contratou (ex.: Casamento Ana e Leo).'
  else if (name.length > CONTRACTOR_NAME_MAX) {
    errors.contractorName = `Use até ${CONTRACTOR_NAME_MAX} caracteres.`
  }
  if (!DATE.test(form.startsOn)) errors.startsOn = 'Escolha a data do evento.'
  const endsOn = form.endsOn.trim()
  if (endsOn && !DATE.test(endsOn)) errors.endsOn = 'Data inválida.'
  else if (endsOn && DATE.test(form.startsOn) && endsOn < form.startsOn) {
    errors.endsOn = 'A data final não pode ser antes da data do evento.'
  }
  const amountText = form.agreedAmount.trim()
  const amount = amountText ? parseReais(amountText) : null
  if (amountText && amount === null) errors.agreedAmount = 'Valor inválido (ex.: 1.500,00).'
  const quantityText = form.agreedQuantity.trim()
  const quantity = quantityText ? parseInteger(quantityText) : null
  if (quantityText && (quantity === null || quantity < 1 || quantity > AGREED_QUANTITY_MAX)) {
    errors.agreedQuantity = 'Use um número inteiro maior que zero (ex.: 500).'
  }
  const limits = form.limits.trim()
  if (limits.length > EVENT_LIMITS_MAX) errors.limits = `Use até ${EVENT_LIMITS_MAX} caracteres.`
  const notes = form.notes.trim()
  if (notes.length > EVENT_NOTES_MAX) errors.notes = `Use até ${EVENT_NOTES_MAX} caracteres.`
  if (Object.keys(errors).length) return { body: null, errors }
  return {
    body: {
      contractorName: name,
      startsOn: form.startsOn,
      endsOn: endsOn || null,
      modality: form.modality,
      agreedAmountCents: amount,
      agreedQuantity: quantity,
      limits: limits || null,
      notes: notes || null,
      priceListId: form.priceListId || null,
    },
    errors,
  }
}

const STATUS_RANK: Record<ContractedEvent['status'], number> = {
  in_progress: 0,
  scheduled: 1,
  finished: 2,
  canceled: 3,
}

/**
 * Ordem da lista (spec 04, seção 8.3): em andamento no topo, depois os agendados do mais próximo
 * ao mais distante, depois encerrados e cancelados do mais recente ao mais antigo.
 */
export function sortEvents(events: readonly ContractedEvent[]): ContractedEvent[] {
  return [...events].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
    if (rank !== 0) return rank
    if (a.status === 'scheduled' || a.status === 'in_progress') {
      return a.startsOn.localeCompare(b.startsOn)
    }
    return b.startsOn.localeCompare(a.startsOn)
  })
}

/** "02/10/2026" ou "02/10/2026 a 04/10/2026". */
export function eventDates(event: Pick<ContractedEvent, 'startsOn' | 'endsOn'>): string {
  if (!event.endsOn || event.endsOn === event.startsOn) return longDay(event.startsOn)
  return `${longDay(event.startsOn)} a ${longDay(event.endsOn)}`
}

/** Resumo do acordo numa linha: "Valor fixo · R$ 1.500,00 · 500 combinados · 18h às 23h". */
export function agreementSummary(
  event: Pick<ContractedEvent, 'agreedAmountCents' | 'agreedQuantity' | 'limits'>,
): string {
  return [
    event.agreedAmountCents !== null ? formatCents(event.agreedAmountCents) : '',
    event.agreedQuantity !== null ? `${event.agreedQuantity} combinados` : '',
    event.limits ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface EventPermissions {
  isOwner: boolean
  /** Dono ou quem opera caixa na unidade do evento (RN-04.34). */
  canOperateCash: boolean
}

/** Ações disponíveis no detalhe do evento (RN-04.34, RN-04.37; spec 07, RN-07.07). */
export function eventActions(event: Pick<ContractedEvent, 'status'>, who: EventPermissions) {
  const open = event.status === 'scheduled' || event.status === 'in_progress'
  return {
    edit: who.isOwner && open,
    start: who.canOperateCash && event.status === 'scheduled',
    finish: who.canOperateCash && event.status === 'in_progress',
    cancel: who.isOwner && event.status === 'scheduled',
    report: who.isOwner && (event.status === 'in_progress' || event.status === 'finished'),
  }
}
