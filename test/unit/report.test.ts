import { describe, expect, it } from 'vitest'
import {
  actorName,
  addDays,
  agreementDifferenceLabel,
  daysInRange,
  filtersFromQuery,
  filtersToQuery,
  formatDay,
  formatDayWithWeekday,
  formatRange,
  historyQuery,
  isForbidden,
  isValidDay,
  presetOf,
  presetRange,
  rangeError,
  todayInSaoPaulo,
} from '../../app/lib/report'

describe('dia de hoje em Brasília (spec 07, seção 11)', () => {
  it('usa o fuso de Brasília, não o UTC', () => {
    // 02:30 UTC do dia 2 ainda é dia 1 em Brasília (UTC−3).
    expect(todayInSaoPaulo(new Date('2026-10-02T02:30:00Z'))).toBe('2026-10-01')
    expect(todayInSaoPaulo(new Date('2026-10-02T03:30:00Z'))).toBe('2026-10-02')
  })
})

describe('atalhos de período (spec 07, seção 5)', () => {
  const today = '2026-10-15'

  it('hoje, 7 dias, 30 dias e mês atual contam o dia de hoje', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today })
    expect(presetRange('7d', today)).toEqual({ from: '2026-10-09', to: today })
    expect(presetRange('30d', today)).toEqual({ from: '2026-09-16', to: today })
    expect(presetRange('month', today)).toEqual({ from: '2026-10-01', to: today })
    expect(daysInRange(presetRange('7d', today))).toBe(7)
    expect(daysInRange(presetRange('30d', today))).toBe(30)
  })

  it('reconhece o atalho de um período, e nenhum num período escolhido à mão', () => {
    expect(presetOf({ from: '2026-09-16', to: today }, today)).toBe('30d')
    expect(presetOf({ from: '2026-09-01', to: '2026-09-30' }, today)).toBeNull()
  })

  it('soma dias atravessando mês e ano bissexto', () => {
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('período escolhido à mão (1 a 366 dias)', () => {
  it('aceita de um dia até 366', () => {
    expect(rangeError({ from: '2026-10-01', to: '2026-10-01' })).toBeNull()
    expect(rangeError({ from: '2025-10-01', to: '2026-10-01' })).toBeNull()
  })

  it('recusa data inválida, ordem trocada e período longo demais', () => {
    expect(rangeError({ from: '', to: '2026-10-01' })).toMatch(/Escolha o primeiro/)
    expect(isValidDay('2026-02-30')).toBe(false)
    expect(rangeError({ from: '2026-10-02', to: '2026-10-01' })).toMatch(/antes do último/)
    expect(rangeError({ from: '2025-09-30', to: '2026-10-01' })).toMatch(/até 366 dias/)
  })
})

describe('filtros do histórico na URL', () => {
  const today = '2026-10-15'

  it('sem filtros, os últimos 30 dias de todas as unidades e tipos', () => {
    expect(filtersFromQuery({}, today)).toEqual({
      from: '2026-09-16',
      to: today,
      unitId: null,
      type: null,
    })
  })

  it('lê e escreve período, unidade e tipo; valores inválidos caem no padrão', () => {
    const filters = filtersFromQuery(
      { de: '2026-09-01', ate: '2026-09-30', unidade: 'u1', tipo: 'contracted' },
      today,
    )
    expect(filters).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      unitId: 'u1',
      type: 'contracted',
    })
    expect(filtersToQuery(filters)).toEqual({
      de: '2026-09-01',
      ate: '2026-09-30',
      unidade: 'u1',
      tipo: 'contracted',
    })
    expect(historyQuery(filters)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      unitId: 'u1',
      type: 'contracted',
    })
    const invalid = filtersFromQuery({ de: '2026-10-02', ate: '2026-10-01', tipo: 'x' }, today)
    expect(invalid).toMatchObject({ from: '2026-09-16', to: today, type: null })
    expect(historyQuery(invalid)).toEqual({ from: '2026-09-16', to: today })
  })
})

describe('textos dos relatórios', () => {
  it('formata o dia sem converter fuso', () => {
    expect(formatDay('2026-10-01')).toBe('01/10/2026')
    expect(formatDayWithWeekday('2026-10-01')).toBe('qui, 01/10/2026')
    expect(formatRange({ from: '2026-09-01', to: '2026-09-30' })).toBe('01/09/2026 a 30/09/2026')
    expect(formatRange({ from: '2026-10-01', to: '2026-10-01' })).toBe('01/10/2026')
  })

  it('nomeia quem fez a ação, inclusive sistema e suporte', () => {
    expect(actorName({ id: 'a', name: 'Ana', type: 'staff' })).toBe('Ana')
    expect(actorName({ id: null, name: null, type: 'system' })).toBe('Sistema')
    expect(actorName({ id: 'x', name: null, type: 'platform_admin' })).toBe('Suporte do Varal')
    expect(actorName(null)).toBe('—')
  })

  it('diferença do acordo: combinada − consumida (CA-07.03)', () => {
    expect(agreementDifferenceLabel(38)).toBe('Faltaram 38 para o combinado')
    expect(agreementDifferenceLabel(-5)).toBe('Passou 5 do combinado')
    expect(agreementDifferenceLabel(0)).toBe('Consumiu exatamente o combinado')
    expect(agreementDifferenceLabel(null)).toBe('Sem quantidade combinada')
  })

  it('reconhece o 403 de colaborador pedindo relatório (RN-07.07, CA-07.06)', () => {
    expect(isForbidden({ error: { code: 'FORBIDDEN', message: 'Só o dono.' } })).toBe(true)
    expect(isForbidden({ error: { code: 'NOT_FOUND', message: 'Não existe.' } })).toBe(false)
    expect(isForbidden(undefined)).toBe(false)
  })
})
