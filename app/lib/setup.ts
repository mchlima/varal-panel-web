/**
 * Regras e textos da configuração da unidade (spec 03) usados por várias telas.
 */
import type { components } from '../api/schema'
import { apiErrorCode, apiErrorMessage, isApiErrorBody } from './api-error'

type Schemas = components['schemas']
export type StationKind = Schemas['StationKind']
export type SetupErrorCode = Schemas['SetupErrorCode']

export const STATION_KIND_LABELS: Record<StationKind, string> = {
  counter: 'Balcão de pedidos',
  queue: 'Fila (cozinha, entrega…)',
}

/** Limites do tempo de atraso da unidade (spec 03, seção 3). */
export const LATE_AFTER_MIN = 1
export const LATE_AFTER_MAX = 240

/** RN-03.13: `0 ≤ mínimo ≤ máximo` e `máximo ≥ 1`. Devolve a mensagem do problema, ou `null`. */
export function modifierLimitsError(min: number, max: number): string | null {
  if (!Number.isInteger(min) || !Number.isInteger(max)) return 'Use números inteiros.'
  if (max < 1) return 'O máximo precisa ser pelo menos 1.'
  if (min < 0) return 'O mínimo não pode ser negativo.'
  if (min > max) return 'O mínimo não pode ser maior que o máximo.'
  return null
}

/** Descrição curta da regra de escolhas de um grupo de modificadores. */
export function choicesLabel(min: number, max: number): string {
  if (min === 0) return max === 1 ? 'Opcional, até 1' : `Opcional, até ${max}`
  if (min === max) return min === 1 ? 'Obrigatório, escolha 1' : `Obrigatório, escolha ${min}`
  return `Obrigatório, de ${min} a ${max}`
}

/** Lê um inteiro digitado ("15"); `null` se não for um inteiro. */
export function parseInteger(input: string): number | null {
  const text = input.trim()
  if (!/^-?\d+$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

/** O evento traz uma versão mais nova que a que a tela tem (spec 01, seção 10). */
export function isNewer(eventVersion: number, knownVersion: number | null | undefined): boolean {
  return knownVersion === null || knownVersion === undefined || eventVersion > knownVersion
}

/**
 * Explicação extra para os erros da configuração que pedem uma ação do dono, além da
 * `message` da API (que já é em pt-BR).
 */
const HINTS: Partial<Record<string, string>> = {
  // RN-03.07 e RN-03.02 (ajustadas em 2026-10-02): o caixa aberto trava fluxo, estações e unidade.
  CASH_REGISTER_OPEN:
    'Enquanto houver caixa aberto nesta unidade, isso fica travado. Feche o caixa (em Caixa) e tente de novo.',
  ITEMS_IN_PROGRESS:
    'Ainda há itens sendo preparados em comandas abertas. Conclua ou cancele esses itens nas estações e tente de novo.',
  UNIT_HAS_OPEN_TABS:
    'Esta unidade ainda tem comandas abertas. Receba, pendure ou cancele essas comandas no balcão antes.',
  INVALID_TIME_LIMITS:
    'O tempo de atenção precisa ser menor que o de atraso (ex.: atenção em 7 e atraso em 15 minutos).',
  // Tabelas de preço (spec 03, seção 5.3)
  PRICE_LIST_NAME_TAKEN: 'Já existe uma tabela com esse nome nesta unidade. Use outro nome.',
  PRICE_LIST_NAME_RESERVED:
    '"Normal" é o nome do preço de sempre do cardápio e não pode ser usado numa tabela. Escolha outro nome, como "Evento".',
  PRICE_LIST_IN_USE:
    'Esta tabela está em uso: é a tabela vigente ou a de um evento agendado ou em andamento. Troque a tabela vigente ou a do evento antes de desativar.',
  // Caixas da unidade (spec 05, seção 5.1)
  LAST_ACTIVE_CASH_REGISTER:
    'A unidade precisa de pelo menos um caixa ativo. Crie ou ative outro caixa antes de desativar este.',
  CASH_REGISTER_NAME_TAKEN: 'Já existe um caixa com esse nome nesta unidade. Use outro nome.',
  // Eventos contratados (spec 04, seção 3.3)
  EVENT_ALREADY_IN_PROGRESS:
    'Já há um evento em andamento nesta unidade. Encerre aquele evento antes de iniciar outro.',
  EVENT_IN_PROGRESS:
    'Durante um evento, os preços são os da tabela do evento. Para trocar, edite o evento ou encerre-o.',
  EVENT_NOT_SCHEDULED: 'Este evento não está mais agendado: atualize a tela para ver a situação.',
  EVENT_NOT_IN_PROGRESS: 'Este evento não está em andamento: atualize a tela para ver a situação.',
  EVENT_CLOSED: 'Evento encerrado ou cancelado não pode mais ser alterado.',
  INVALID_PRICE_LIST:
    'A tabela de preço escolhida não está ativa nesta unidade. Escolha outra ou "Normal".',
  LAST_ACTIVE_UNIT:
    'Ative ou crie outra unidade antes de desativar esta: a organização sempre tem uma unidade em funcionamento.',
  STATION_KIND_REQUIRED:
    'Cada unidade precisa de um balcão de pedidos e de uma fila ativos. Crie ou ative outra antes.',
  VERSION_CONFLICT:
    'Outro aparelho alterou estes dados enquanto você editava. Recarregue para ver a versão atual.',
  // Fiado (spec 06)
  CUSTOMER_HAS_RECEIVABLE:
    'Cliente com fiado a receber não pode ser removido (RN-06.03): quite as comandas dele antes. Os dados ficam guardados até lá.',
  CUSTOMER_PHONE_TAKEN: 'Já existe um cliente com este telefone nesta unidade: busque por ele.',
  CUSTOMER_CPF_TAKEN: 'Já existe um cliente com este CPF nesta unidade: busque por ele.',
  CUSTOMER_CHANGED:
    'Outro aparelho alterou este cliente enquanto você editava. Feche e abra de novo para ver a versão atual.',
  CUSTOMER_REMOVED: 'Cliente removido não pode ser editado nem receber comandas.',
}

export interface ExplainedError {
  code: string | undefined
  message: string
  hint?: string
  details: Record<string, unknown>
}

export function explainError(error: unknown): ExplainedError {
  const code = apiErrorCode(error)
  const details = isApiErrorBody(error) ? (error.error.details ?? {}) : {}
  let hint = code ? HINTS[code] : undefined
  if (code === 'STATION_IN_USE') hint = stationInUseHint(details)
  return { code, message: apiErrorMessage(error), hint, details }
}

/** `STATION_IN_USE` traz quantas etapas, categorias e produtos usam a estação. */
export function stationInUseHint(details: Record<string, unknown>): string {
  const count = (key: string) => (typeof details[key] === 'number' ? (details[key] as number) : 0)
  const parts = [
    plural(count('stages'), 'etapa do fluxo', 'etapas do fluxo'),
    plural(count('categories'), 'categoria', 'categorias'),
    plural(count('products'), 'produto', 'produtos'),
  ].filter(Boolean)
  return parts.length
    ? `Em uso por: ${parts.join(', ')}. Troque a estação deles antes de desativar ou mudar o tipo.`
    : 'Troque a estação do fluxo, das categorias e dos produtos antes de desativar ou mudar o tipo.'
}

function plural(n: number, one: string, many: string): string {
  if (n <= 0) return ''
  return `${n} ${n === 1 ? one : many}`
}
