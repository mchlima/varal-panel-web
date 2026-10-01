import { describe, expect, it } from 'vitest'
import {
  activeSubtotalCents,
  elapsedLabel,
  isItemLate,
  isReadyToDeliver,
  itemConflictMessage,
  itemTotalCents,
  nextStage,
  pendingItemsOf,
  previousStage,
  rejectionMessage,
  stageTone,
  stagesOfStation,
} from '../../app/lib/operation'
import { pendingLabel, pendingForItem } from '../../app/lib/operation-actions'
import { buildOpenShift, emptyAgreement, parsePrices, summarizeTabs } from '../../app/lib/shift'
import { DELIVERY, KITCHEN, item, stages, tabSummary } from '../support/operation-fixtures'

describe('etapas e cores de status (spec 08, seção 4)', () => {
  it('primeira = Novo, do meio = Preparando, anterior à final = Pronto, final = Entregue', () => {
    const tones = stages.map((stage) =>
      stageTone(stages, { stageId: stage.id, stageIsFinal: stage.isFinal }),
    )
    expect(tones).toEqual(['new', 'preparing', 'ready', 'delivered'])
  })

  it('próxima e anterior etapa', () => {
    expect(nextStage(stages, 's1')?.name).toBe('Preparando')
    expect(nextStage(stages, 's4')).toBeNull()
    expect(previousStage(stages, 's1')).toBeNull()
    expect(previousStage(stages, 's3')?.name).toBe('Preparando')
  })

  it('RN-04.21: o balcão entrega o que está na etapa anterior à final', () => {
    expect(isReadyToDeliver(stages, item({ stageId: 's3' }))).toBe(true)
    expect(isReadyToDeliver(stages, item({ stageId: 's2' }))).toBe(false)
    expect(
      isReadyToDeliver(stages, item({ stageId: 's3', canceledAt: '2026-10-01T20:00:00Z' })),
    ).toBe(false)
  })

  it('filtro por etapa: as da estação de preparo e as fixas nela', () => {
    expect(stagesOfStation(stages, KITCHEN).map((s) => s.name)).toEqual(['Recebido', 'Preparando'])
    expect(stagesOfStation(stages, DELIVERY).map((s) => s.name)).toEqual([
      'Recebido',
      'Preparando',
      'Pronto',
    ])
  })
})

describe('atraso calculado com o relógio (RN-04.23, CA-04.11)', () => {
  const lateAt = Date.parse('2026-10-01T20:15:00.000Z')

  it('atrasado a partir de lateAt, sem esperar a API', () => {
    expect(isItemLate(item(), lateAt - 1)).toBe(false)
    expect(isItemLate(item(), lateAt)).toBe(true)
  })

  it('nunca atrasado na etapa final ou cancelado', () => {
    expect(isItemLate(item({ stageIsFinal: true, lateAt: null }), lateAt + 60_000)).toBe(false)
    expect(isItemLate(item({ canceledAt: '2026-10-01T20:01:00Z' }), lateAt + 60_000)).toBe(false)
  })

  it('tempo desde o pedido', () => {
    const sent = '2026-10-01T20:00:00.000Z'
    expect(elapsedLabel(sent, Date.parse(sent) + 30_000)).toBe('agora')
    expect(elapsedLabel(sent, Date.parse(sent) + 12 * 60_000)).toBe('há 12 min')
    expect(elapsedLabel(sent, Date.parse(sent) + 65 * 60_000)).toBe('há 1 h 05 min')
  })
})

describe('totais exibidos (RN-04.14)', () => {
  it('valor do item com acréscimos e subtotal só dos não cancelados', () => {
    const withBread = item({
      quantity: 2,
      modifiers: [
        {
          modifierId: 'm',
          groupName: 'Acompanhamentos',
          modifierName: 'Pão de alho',
          priceDeltaCents: 300,
        },
      ],
    })
    expect(itemTotalCents(withBread)).toBe(3000)
    const canceled = item({ id: 'x', canceledAt: '2026-10-01T20:01:00Z' })
    expect(activeSubtotalCents([withBread, canceled])).toBe(3000)
  })
})

describe('mensagens', () => {
  it('explica a recusa de cada item do pedido (CA-04.06)', () => {
    expect(rejectionMessage('sold_out')).toBe('Esgotado: tire do pedido.')
    expect(rejectionMessage('modifier_required', 'Ponto da carne')).toBe(
      'Falta escolher: Ponto da carne.',
    )
  })

  it('CA-04.05: explica que a ação não foi aplicada e mostra a etapa atual', () => {
    expect(itemConflictMessage('ITEM_CHANGED', item({ stageName: 'Pronto', quantity: 2 }))).toBe(
      'Outro aparelho mexeu neste item antes: agora está em Pronto (2). Sua ação não foi aplicada.',
    )
    expect(itemConflictMessage('TAB_CLOSED', null)).toBeNull()
  })

  it('lê as pendências do fechamento do turno (CA-04.09)', () => {
    expect(
      pendingItemsOf({
        tabs: [{ id: 't1', number: 1, customerName: 'Dona Marta', status: 'open' }],
        cashRegisters: [],
      }).tabs[0]!.number,
    ).toBe(1)
    expect(pendingItemsOf({})).toEqual({ tabs: [], cashRegisters: [] })
  })
})

describe('fila de escrita: estado pendente honesto (spec 01, seção 11)', () => {
  const action = (meta: unknown, attempts = 0) => ({
    idempotencyKey: `k-${Math.random()}`,
    method: 'POST' as const,
    path: '/x',
    label: 'x',
    meta,
    createdAt: 0,
    attempts,
    nextAttemptAt: 0,
    status: 'pending' as const,
  })

  it('"Enviando…" na primeira tentativa com rede; "Na fila" sem rede ou depois de falhar', () => {
    expect(pendingLabel({ attempts: 0 }, true)).toBe('Enviando…')
    expect(pendingLabel({ attempts: 0 }, false)).toBe('Na fila')
    expect(pendingLabel({ attempts: 2 }, true)).toBe('Na fila')
  })

  it('acha a ação pendente de um item pelo meta', () => {
    const actions = [
      action({ kind: 'tab.order', tabId: 't1', tabNumber: 1, lines: [] }),
      action({ kind: 'item.advance', itemId: 'i1', tabId: 't1', quantity: 2 }),
      action({ kind: 'outra-coisa' }),
    ]
    expect(pendingForItem(actions, 'i1')?.meta).toMatchObject({ kind: 'item.advance', quantity: 2 })
    expect(pendingForItem(actions, 'i2')).toBeNull()
  })
})

describe('turno (RN-04.04 a RN-04.06)', () => {
  it('turno contratado exige o contratante; valor e quantidade são opcionais', () => {
    const missing = buildOpenShift('contracted', emptyAgreement(), {})
    expect(missing.body).toBeNull()
    expect(missing.errors.contractorName).toBeDefined()

    const ok = buildOpenShift(
      'contracted',
      {
        ...emptyAgreement(),
        contractorName: 'Festa da Escola',
        agreedAmount: '1.500,00',
        agreedQuantity: '500',
      },
      { p1: '10,00', p2: '' },
    )
    expect(ok.body).toEqual({
      type: 'contracted',
      prices: [{ productId: 'p1', priceCents: 1000 }],
      agreement: {
        contractorName: 'Festa da Escola',
        modality: 'fixed_fee',
        agreedAmountCents: 150_000,
        agreedQuantity: 500,
        limits: null,
        notes: null,
      },
    })
  })

  it('venda direta não leva acordo; preço inválido é apontado no produto', () => {
    expect(buildOpenShift('direct_sale', emptyAgreement(), {}).body).toEqual({
      type: 'direct_sale',
      prices: [],
      agreement: null,
    })
    expect(parsePrices({ p1: 'abc' }).errors).toEqual({ p1: 'Valor inválido.' })
  })

  it('resumo do turno: contagens e valor sem as canceladas', () => {
    const summary = summarizeTabs([
      tabSummary(),
      tabSummary({ id: 'b', status: 'closing', totalCents: 1000, itemCount: 1 }),
      tabSummary({ id: 'c', status: 'canceled', totalCents: 0, itemCount: 2 }),
      tabSummary({ id: 'd', status: 'paid', totalCents: 500, itemCount: 1 }),
    ])
    expect(summary).toEqual({ open: 1, closing: 1, closed: 1, totalCents: 5100, items: 5 })
  })
})
