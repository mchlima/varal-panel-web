/**
 * Relatórios do painel do dono (spec 07): tipos da API, atalhos de período (em dias de operação,
 * RN-04.29), rótulos e filtros do histórico. Tudo puro (sem Vue), para ser testado sozinho.
 */
import type { components } from '../api/schema'
import { apiErrorCode } from './api-error'
import { addDays, todayInSaoPaulo as todayInSaoPauloAt } from './operation'

type Schemas = components['schemas']
export type SummaryReport = Schemas['SummaryReport']
export type ReportSummary = Schemas['ReportSummary']
export type ReportTotals = Schemas['ReportTotals']
export type DayHistory = Schemas['DayHistory']
export type DayHistoryRow = Schemas['DayHistoryRow']
export type CashSessionHistory = Schemas['CashSessionHistory']
export type ReportCashSessionLine = Schemas['ReportCashSessionLine']
export type CashSessionReport = Schemas['CashSessionReport']
export type EventHistory = Schemas['EventHistory']
export type EventHistoryRow = Schemas['EventHistoryRow']
export type EventReport = Schemas['EventReport']
export type ReportProductLine = Schemas['ReportProductLine']
export type ReportActor = Schemas['ReportActor']
export type ReportCreditTab = Schemas['ReportCreditTab']
export type ReportSettlement = Schemas['ReportSettlement']
export type ReportCanceledItem = Schemas['ReportCanceledItem']
export type ReportCanceledTab = Schemas['ReportCanceledTab']

export { addDays }

/** Fuso de exibição e dos dias do período (spec 07, seção 13). */
export const REPORT_TIME_ZONE = 'America/Sao_Paulo'

/** O período vai de 1 a 366 dias (spec 07, seção 13). */
export const MAX_PERIOD_DAYS = 366

export type PeriodPreset = 'today' | '7d' | '30d' | 'month'

/** Atalhos do período (spec 07, seção 7), na ordem dos botões. */
export const PERIOD_PRESETS: readonly { value: PeriodPreset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'month', label: 'Mês atual' },
]

/** Padrão do histórico: os últimos 30 dias até hoje (spec 07, seção 13). */
export const DEFAULT_PRESET: PeriodPreset = '30d'

export interface DayRange {
  /** Dia de operação AAAA-MM-DD. */
  from: string
  /** AAAA-MM-DD, inclusive. */
  to: string
}

/** Dia de hoje (ou de `now`) em Brasília, como `AAAA-MM-DD`. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return todayInSaoPauloAt(now.getTime())
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

/** `2026-10-01` → `01/10/2026` (dia de operação: não converte fuso). */
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

/** Datas do evento: o dia, ou `01/10/2026 a 02/10/2026` nos eventos de mais de um dia. */
export function eventDates(event: { startsOn: string; endsOn: string | null }): string {
  return formatRange({ from: event.startsOn, to: event.endsOn ?? event.startsOn })
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

/** Abas do histórico (spec 07, seção 7). */
export type HistoryTab = 'dias' | 'caixas' | 'eventos'
export const HISTORY_TABS: readonly { value: HistoryTab; label: string }[] = [
  { value: 'dias', label: 'Dias' },
  { value: 'caixas', label: 'Caixas' },
  { value: 'eventos', label: 'Eventos' },
]

/**
 * Filtros do histórico na URL (`?aba=&de=&ate=&unidade=`), para voltar de um relatório com os
 * mesmos filtros. Valores inválidos caem no padrão.
 */
export interface HistoryFilters extends DayRange {
  unitId: string | null
  tab: HistoryTab
}

type QueryValue = string | null | undefined | (string | null)[]

function single(value: QueryValue): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first ? first : null
}

/** Período da URL (`de`, `ate`), ou o padrão quando falta ou é inválido. */
export function rangeFromQuery(
  query: Record<string, QueryValue>,
  today: string,
  fallback: PeriodPreset = DEFAULT_PRESET,
): DayRange {
  const from = single(query.de)
  const to = single(query.ate)
  const custom = from && to ? { from, to } : null
  return custom && !rangeError(custom) ? custom : presetRange(fallback, today)
}

export function filtersFromQuery(query: Record<string, QueryValue>, today: string): HistoryFilters {
  const tab = single(query.aba)
  return {
    ...rangeFromQuery(query, today),
    unitId: single(query.unidade),
    tab: tab === 'caixas' || tab === 'eventos' ? tab : 'dias',
  }
}

export function filtersToQuery(filters: HistoryFilters): Record<string, string> {
  const query: Record<string, string> = { de: filters.from, ate: filters.to }
  if (filters.unitId) query.unidade = filters.unitId
  if (filters.tab !== 'dias') query.aba = filters.tab
  return query
}

/** Parâmetros comuns do histórico e do relatório do período (spec 07, seção 10). */
export function historyQuery(filters: DayRange & { unitId: string | null }): {
  from: string
  to: string
  unitId?: string
} {
  return {
    from: filters.from,
    to: filters.to,
    ...(filters.unitId ? { unitId: filters.unitId } : {}),
  }
}

/** Link do relatório do dia ou período (`/painel/relatorios/periodo?unidade=&de=&ate=`). */
export function periodReportPath(filters: DayRange & { unitId: string | null }): string {
  const query = new URLSearchParams()
  if (filters.unitId) query.set('unidade', filters.unitId)
  query.set('de', filters.from)
  query.set('ate', filters.to)
  return `/painel/relatorios/periodo?${query.toString()}`
}

/**
 * Resumo de hoje no início do painel (spec 07, seção 11; spec 01, RN-01.24): consulta do
 * `GET /reports/summary` para o dia de operação atual da unidade.
 */
export function todaySummaryQuery(
  unitId: string,
  businessDate: string,
): { unitId: string; from: string; to: string } {
  return { unitId, from: businessDate, to: businessDate }
}

/** Link do relatório do dia de uma unidade (o "Ver relatório do dia" do início). */
export function dayReportPath(unitId: string, businessDate: string): string {
  return periodReportPath({ unitId, from: businessDate, to: businessDate })
}

/** "1 comanda", "3 comandas" e afins. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "vendas R$ 30,00 · quitações R$ 60,00" (RN-07.02), com o formatador de moeda do app. */
export function receivedDetail(
  values: { receivedSalesCents: number; receivedSettlementsCents: number },
  format: (cents: number) => string,
): string {
  return `vendas ${format(values.receivedSalesCents)} · quitações ${format(values.receivedSettlementsCents)}`
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

/** Consumo contra o combinado numa linha do histórico de eventos: "462 de 500". */
export function consumptionLabel(row: {
  consumedQuantity: number
  agreedQuantity: number | null
}): string {
  return row.agreedQuantity === null
    ? `${row.consumedQuantity} consumidos`
    : `${row.consumedQuantity} de ${row.agreedQuantity}`
}
