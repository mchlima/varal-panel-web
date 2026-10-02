import { describe, expect, it } from 'vitest'
import {
  agreementSummary,
  buildEventBody,
  emptyEventForm,
  eventActions,
  eventDates,
  eventToForm,
  sortEvents,
} from '../../app/lib/events'
import type { ContractedEvent } from '../../app/lib/operation'
import { priceChanges, priceListNameError, productCountLabel } from '../../app/lib/price-lists'

function event(overrides: Partial<ContractedEvent> = {}): ContractedEvent {
  return {
    id: 'e1',
    unitId: 'u1',
    contractorName: 'Casamento Ana e Leo',
    startsOn: '2026-10-10',
    endsOn: null,
    modality: 'fixed_fee',
    agreedAmountCents: 150000,
    agreedQuantity: 500,
    limits: 'das 18h às 23h',
    notes: null,
    priceList: { id: 'pl', name: 'Evento' },
    status: 'scheduled',
    startedAt: null,
    startedBy: null,
    finishedAt: null,
    finishedBy: null,
    canceledAt: null,
    version: 1,
    ...overrides,
  }
}

describe('cadastro do evento (RN-04.05)', () => {
  it('monta o corpo com centavos, quantidade inteira e "Normal" como null', () => {
    const form = {
      ...emptyEventForm('2026-10-10'),
      contractorName: '  Festa   da Empresa ',
      modality: 'per_quantity' as const,
      agreedAmount: '1.500,00',
      agreedQuantity: '500',
      limits: '500 espetos',
    }
    const { body, errors } = buildEventBody(form)
    expect(errors).toEqual({})
    expect(body).toEqual({
      contractorName: 'Festa da Empresa',
      startsOn: '2026-10-10',
      endsOn: null,
      modality: 'per_quantity',
      agreedAmountCents: 150000,
      agreedQuantity: 500,
      limits: '500 espetos',
      notes: null,
      priceListId: null,
    })
  })

  it('exige contratante (até 60) e data; data final não vem antes da inicial', () => {
    const { body, errors } = buildEventBody({
      ...emptyEventForm(''),
      contractorName: 'x'.repeat(61),
      endsOn: '2026-10-01',
    })
    expect(body).toBeNull()
    expect(errors.contractorName).toContain('60')
    expect(errors.startsOn).toBeDefined()
    const late = buildEventBody({
      ...emptyEventForm('2026-10-10'),
      contractorName: 'Ana',
      endsOn: '2026-10-09',
      agreedQuantity: '0',
      agreedAmount: 'abc',
    })
    expect(late.errors.endsOn).toContain('antes')
    expect(late.errors.agreedQuantity).toBeDefined()
    expect(late.errors.agreedAmount).toBeDefined()
  })

  it('volta ao formulário para editar', () => {
    const form = eventToForm(event())
    expect(form.agreedAmount).toBe('1500,00')
    expect(form.agreedQuantity).toBe('500')
    expect(form.priceListId).toBe('pl')
  })
})

describe('lista de eventos (spec 04, seção 8.3)', () => {
  it('em andamento no topo, agendados mais próximos primeiro, depois encerrados', () => {
    const list = sortEvents([
      event({ id: 'done', status: 'finished', startsOn: '2026-09-01' }),
      event({ id: 'far', startsOn: '2026-12-01' }),
      event({ id: 'now', status: 'in_progress', startsOn: '2026-10-02' }),
      event({ id: 'near', startsOn: '2026-10-05' }),
      event({ id: 'off', status: 'canceled', startsOn: '2026-10-03' }),
    ])
    expect(list.map((item) => item.id)).toEqual(['now', 'near', 'far', 'done', 'off'])
  })

  it('datas e resumo do acordo', () => {
    expect(eventDates(event())).toBe('10/10/2026')
    expect(eventDates(event({ endsOn: '2026-10-12' }))).toBe('10/10/2026 a 12/10/2026')
    expect(agreementSummary(event())).toBe('R$ 1.500,00 · 500 combinados · das 18h às 23h')
  })
})

describe('quem faz o quê no evento (RN-04.34, RN-04.37, RN-07.07)', () => {
  const owner = { isOwner: true, canOperateCash: true }
  const cashier = { isOwner: false, canOperateCash: true }

  it('dono edita, inicia e cancela o agendado; quem opera caixa só inicia', () => {
    expect(eventActions(event(), owner)).toEqual({
      edit: true,
      start: true,
      finish: false,
      cancel: true,
      report: false,
    })
    expect(eventActions(event(), cashier)).toEqual({
      edit: false,
      start: true,
      finish: false,
      cancel: false,
      report: false,
    })
  })

  it('em andamento: encerra; relatório só para o dono; encerrado não edita', () => {
    expect(eventActions(event({ status: 'in_progress' }), cashier).finish).toBe(true)
    expect(eventActions(event({ status: 'in_progress' }), cashier).report).toBe(false)
    expect(eventActions(event({ status: 'in_progress' }), owner).report).toBe(true)
    expect(eventActions(event({ status: 'finished' }), owner)).toEqual({
      edit: false,
      start: false,
      finish: false,
      cancel: false,
      report: true,
    })
  })
})

describe('tabelas de preço (RN-03.20 a RN-03.22)', () => {
  it('CA-03.10: "Normal" é reservado e o nome não se repete (sem diferenciar maiúsculas)', () => {
    const lists = [{ id: 'a', name: 'Evento' }]
    expect(priceListNameError(' normal ')).toContain('Normal')
    expect(priceListNameError('EVENTO', lists)).toContain('Já existe')
    expect(priceListNameError('Evento', lists, 'a')).toBeNull()
    expect(priceListNameError('')).toBeDefined()
    expect(priceListNameError('x'.repeat(31))).toContain('30')
    expect(priceListNameError('Casamento', lists)).toBeNull()
  })

  it('RN-03.22: envia só o que mudou; vazio remove (preço normal); inválido vira erro', () => {
    const { changes, errors } = priceChanges(
      { carne: 1500, frango: 1200, queijo: 1000 },
      { carne: '15,00', frango: '', queijo: '11', pao: '8,50', kafta: 'x' },
    )
    expect(changes).toEqual(
      expect.arrayContaining([
        { key: 'frango', priceCents: null },
        { key: 'queijo', priceCents: 1100 },
        { key: 'pao', priceCents: 850 },
      ]),
    )
    expect(changes).toHaveLength(3)
    expect(errors).toEqual({ kafta: 'Valor inválido (ex.: 15,00).' })
  })

  it('conta produtos com preço', () => {
    expect(productCountLabel(0)).toBe('Nenhum produto com preço ainda')
    expect(productCountLabel(1)).toBe('1 produto com preço')
    expect(productCountLabel(4)).toBe('4 produtos com preço')
  })
})
