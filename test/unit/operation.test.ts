import { describe, expect, it } from 'vitest'
import {
  activeSubtotalCents,
  elapsedLabel,
  isItemLate,
  isReadyToDeliver,
  itemConflictMessage,
  itemTotalCents,
  addDays,
  clockLabel,
  nextStage,
  previousStage,
  priceListName,
  shortDay,
  sinceLabel,
  tabSinceLabel,
  timeLevel,
  rejectionMessage,
  stageTone,
  stagesOfStation,
} from '../../app/lib/operation'
import { pendingLabel, pendingForItem } from '../../app/lib/operation-actions'
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

describe('dia de operação e comandas que passam de dia (RN-04.10, RN-04.29)', () => {
  it('CA-04.09: comanda de um dia anterior mostra "desde dd/mm"; a de hoje, nada', () => {
    expect(tabSinceLabel(tabSummary({ businessDate: '2026-10-01' }), '2026-10-02')).toBe(
      'desde 01/10',
    )
    expect(tabSinceLabel(tabSummary({ businessDate: '2026-10-02' }), '2026-10-02')).toBeNull()
    expect(tabSinceLabel(tabSummary({ businessDate: '2026-10-01' }), null)).toBeNull()
  })

  it('datas de operação sem depender do fuso do aparelho', () => {
    expect(shortDay('2026-10-05')).toBe('05/10')
    expect(addDays('2026-10-01', -2)).toBe('2026-09-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('RN-05.26: "desde ontem, 17:02" no horário de Brasília', () => {
    const now = Date.parse('2026-10-02T15:00:00-03:00')
    expect(sinceLabel('2026-10-01T17:02:00-03:00', now)).toBe('ontem, 17:02')
    expect(sinceLabel('2026-10-02T09:15:00-03:00', now)).toBe('hoje, 09:15')
    expect(sinceLabel('2026-09-28T18:00:00-03:00', now)).toBe('28/09, 18:00')
  })

  it('RN-04.06: sem tabela é o preço "Normal"', () => {
    expect(priceListName(null)).toBe('Normal')
    expect(priceListName({ name: 'Evento' })).toBe('Evento')
  })
})

describe('tempo do cartão da estação (RN-04.46, CA-04.24)', () => {
  const sentAt = '2026-10-01T20:00:00.000Z'
  const at = (minutes: number) => Date.parse(sentAt) + minutes * 60_000

  it('normal → atenção (7) → atrasado (15), pelo relógio do aparelho', () => {
    const limits = { attentionAfterMinutes: 7, lateAfterMinutes: 15 }
    expect(timeLevel(sentAt, limits, at(6))).toBe('normal')
    expect(timeLevel(sentAt, limits, at(8))).toBe('attention')
    expect(timeLevel(sentAt, limits, at(16))).toBe('late')
  })

  it('mudar a atenção para 10 volta o cartão de 8 minutos ao normal', () => {
    expect(timeLevel(sentAt, { attentionAfterMinutes: 10, lateAfterMinutes: 15 }, at(8))).toBe(
      'normal',
    )
  })

  it('tempo decorrido em mm:ss e h:mm passada uma hora', () => {
    expect(clockLabel(sentAt, at(0) + 5_000)).toBe('00:05')
    expect(clockLabel(sentAt, at(12) + 34_000)).toBe('12:34')
    expect(clockLabel(sentAt, at(65))).toBe('1:05')
  })
})
