/**
 * Relatórios do painel do dono (spec 07): tipos da API, atalhos de período, rótulos e
 * filtros do histórico. Tudo puro (sem Vue), para ser testado sozinho.
 */
import type { components } from '../api/schema'
import { apiErrorCode } from './api-error'

type Schemas = components['schemas']
export type ShiftReport = Schemas['ShiftReport']
export type ShiftReportSummary = Schemas['ShiftReportSummary']
export type ShiftReportAgreement = Schemas['ShiftReportAgreement']
export type ShiftHistory = Schemas['ShiftHistory']
export type ShiftHistoryRow = Schemas['ShiftHistoryRow']
export type ShiftHistoryTotals = Schemas['ShiftHistoryTotals']
export type ReportActor = Schemas['ReportActor']
export type ReportCashRegister = Schemas['ReportCashRegister']
export type ShiftType = Schemas['ShiftType']

/** Fuso de exibição e dos dias do período (spec 07, seção 11). */
export const REPORT_TIME_ZONE = 'America/Sao_Paulo'

/** O período do histórico vai de 1 a 366 dias (spec 07, seção 11). */
export const MAX_PERIOD_DAYS = 366

export type PeriodPreset = 'today' | '7d' | '30d' | 'month'

/** Atalhos do período (spec 07, seção 5), na ordem dos botões. */
export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Mês atual' },
]

/** Padrão do histórico: os últimos 30 dias até hoje (spec 07, seção 11). */
export const DEFAULT_PRESET: PeriodPreset = '30d'

export interface DayRange {
  /** AAAA-MM-DD, horário de Brasília. */
  from: string
  /** AAAA-MM-DD, inclusive. */
  to: string
}

const isoDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Dia de hoje (ou de `now`) em Brasília, como `AAAA-MM-DD`. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return isoDay.format(now)
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** `AAAA-MM-DD` de um dia que existe no calendário. */
export function isValidDay(value: string): boolean {
  const match = DAY_PATTERN.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function dayToUtc(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return Date.UTC(year, month - 1, date)
}

/** Soma (ou subtrai) dias a um `AAAA-MM-DD`, sem passar por fuso. */
export function addDays(day: string, days: number): string {
  return new Date(dayToUtc(day) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Dias do período, contando o primeiro e o último. */
export function daysInRange(range: DayRange): number {
  return Math.round((dayToUtc(range.to) - dayToUtc(range.from)) / 86_400_000) + 1
}

/** Período de um atalho, relativo a hoje em Brasília. */
export function presetRange(preset: PeriodPreset, today: string): DayRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today }
  }
}

/** O atalho que corresponde ao período, se houver (para marcar o botão). */
export function presetOf(range: DayRange, today: string): PeriodPreset | null {
  for (const { value } of PERIOD_PRESETS) {
    const candidate = presetRange(value, today)
    if (candidate.from === range.from && candidate.to === range.to) return value
  }
  return null
}

/** Erro do período escolhido à mão, em pt-BR; `null` se estiver certo. */
export function rangeError(range: DayRange): string | null {
  if (!isValidDay(range.from) || !isValidDay(range.to)) return 'Escolha o primeiro e o último dia.'
  if (range.from > range.to) return 'O primeiro dia precisa vir antes do último.'
  if (daysInRange(range) > MAX_PERIOD_DAYS) {
    return `Escolha um período de até ${MAX_PERIOD_DAYS} dias.`
  }
  return null
}

/** `2026-10-01` → `01/10/2026` (dia já em Brasília: não converte fuso). */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-')
  return `${date}/${month}/${year}`
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const

/** `2026-10-01` → `qui, 01/10/2026`. */
export function formatDayWithWeekday(day: string): string {
  return `${WEEKDAYS[new Date(dayToUtc(day)).getUTCDay()]}, ${formatDay(day)}`
}

/** Período por extenso: `01/09/2026 a 30/09/2026`, ou só o dia. */
export function formatRange(range: DayRange): string {
  return range.from === range.to
    ? formatDay(range.from)
    : `${formatDay(range.from)} a ${formatDay(range.to)}`
}

/** Nome de quem fez a ação: dono e colaborador pelo nome; sistema e suporte pelo papel. */
export function actorName(actor: ReportActor | null | undefined): string {
  if (!actor) return '—'
  if (actor.name) return actor.name
  if (actor.type === 'platform_admin') return 'Suporte do Varal'
  if (actor.type === 'system') return 'Sistema'
  return actor.type === 'owner' ? 'Dono' : 'Colaborador'
}

/** Relatórios são só do dono (RN-07.07): a API responde 403 `FORBIDDEN` aos colaboradores. */
export function isForbidden(error: unknown): boolean {
  return apiErrorCode(error) === 'FORBIDDEN'
}

export const FORBIDDEN_MESSAGE = 'Relatórios são só do dono da conta.'

/**
 * Filtros do histórico na URL (`?de=&ate=&unidade=&tipo=`), para voltar do relatório de um
 * turno com os mesmos filtros. Valores inválidos caem no padrão.
 */
export interface HistoryFilters extends DayRange {
  unitId: string | null
  type: ShiftType | null
}

type QueryValue = string | null | undefined | (string | null)[]

function single(value: QueryValue): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first ? first : null
}

export function filtersFromQuery(query: Record<string, QueryValue>, today: string): HistoryFilters {
  const fallback = presetRange(DEFAULT_PRESET, today)
  const from = single(query.de)
  const to = single(query.ate)
  const custom = from && to ? { from, to } : null
  const range = custom && !rangeError(custom) ? custom : fallback
  const type = single(query.tipo)
  return {
    ...range,
    unitId: single(query.unidade),
    type: type === 'direct_sale' || type === 'contracted' ? type : null,
  }
}

export function filtersToQuery(filters: HistoryFilters): Record<string, string> {
  const query: Record<string, string> = { de: filters.from, ate: filters.to }
  if (filters.unitId) query.unidade = filters.unitId
  if (filters.type) query.tipo = filters.type
  return query
}

/** Parâmetros do `GET /reports/shifts` (spec 07, seção 8). */
export function historyQuery(filters: HistoryFilters): {
  from: string
  to: string
  unitId?: string
  type?: ShiftType
} {
  return {
    from: filters.from,
    to: filters.to,
    ...(filters.unitId ? { unitId: filters.unitId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  }
}

/** "1 turno", "3 turnos" e afins. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Diferença do acordo (CA-07.03): combinada − consumida. Positiva: sobrou do combinado;
 * negativa: passou do combinado.
 */
export function agreementDifferenceLabel(difference: number | null): string {
  if (difference === null) return 'Sem quantidade combinada'
  if (difference === 0) return 'Consumiu exatamente o combinado'
  return difference > 0
    ? `Faltaram ${difference} para o combinado`
    : `Passou ${-difference} do combinado`
}
