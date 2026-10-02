import { describe, expect, it } from 'vitest'
import { clockLabel, timeLevel, type Order, type StationOrder } from '../../app/lib/operation'
import {
  advanceLabel,
  applyItem,
  applyOrder,
  counters,
  defaultLimits,
  linesToAdvance,
  mergeReload,
  notStarted,
  pushRecent,
  recentFrom,
  sortCards,
  timeLimitsError,
  toLine,
  type CardMap,
  type StationCard,
} from '../../app/lib/station'
import { DELIVERY, KITCHEN, item, stages } from '../support/operation-fixtures'

const FRYER = '0192f000-0000-7000-8000-0000000000a3'
const limits = { attentionAfterMinutes: 7, lateAfterMinutes: 15 }
const sentAt = '2026-10-01T20:00:00.000Z'

function card(overrides: Partial<StationCard> = {}, lines = [item()]): StationCard {
  return {
    orderId: 'o1',
    tabId: 't1',
    tabNumber: 12,
    customerName: 'Dona Marta',
    tabMode: 'open_tab',
    numberInTab: 1,
    isAdditional: false,
    sentAt,
    attentionAt: '2026-10-01T20:07:00.000Z',
    lateAt: '2026-10-01T20:15:00.000Z',
    otherStationsQuantity: 0,
    lines: lines.map((line) => toLine(line, KITCHEN)),
    ackRequired: false,
    ...overrides,
  }
}

function order(items: Order['items'], overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    tabId: 't1',
    unitId: 'u',
    tabNumber: 12,
    customerName: 'Dona Marta',
    numberInTab: 1,
    status: 'sent',
    createdBy: { type: 'owner', id: 'owner' },
    sentAt,
    completedAt: null,
    version: 0,
    items,
    ...overrides,
  }
}

describe('um pedido, um cartão (RN-04.40 a RN-04.45)', () => {
  it('CA-04.20: dois itens da Cozinha no mesmo pedido formam um cartão; o pão de alho feito fica riscado até os espetos', () => {
    const cards: CardMap = {}
    const skewer = item({ id: 'a', quantity: 2, stageId: 's2', stageName: 'Preparando' })
    const bread = item({ id: 'b', productName: 'Pão de alho', quantity: 1, stageId: 's2' })
    applyOrder(cards, order([skewer, bread]), KITCHEN)
    expect(Object.keys(cards)).toEqual(['o1'])
    expect(cards.o1!.lines.map((l) => l.id)).toEqual(['a', 'b'])

    const result = applyItem(
      cards,
      { ...bread, version: 1, stageId: 's3', stageName: 'Pronto', stationId: DELIVERY },
      KITCHEN,
    )
    expect(result.left).toBeNull()
    expect(cards.o1!.lines.find((l) => l.id === 'b')!.state).toBe('done')

    const last = applyItem(
      cards,
      { ...skewer, version: 1, stageId: 's3', stageName: 'Pronto', stationId: DELIVERY },
      KITCHEN,
    )
    expect(last.left?.orderId).toBe('o1')
    expect(cards.o1).toBeUndefined()
  })

  it('RN-04.41: linha que muda para outra etapa da mesma estação continua pendente', () => {
    const cards: CardMap = { o1: card() }
    applyItem(cards, item({ version: 1, stageId: 's2', stageName: 'Preparando' }), KITCHEN)
    expect(cards.o1!.lines[0]!.state).toBe('pending')
    expect(cards.o1!.lines[0]!.stageName).toBe('Preparando')
  })

  it('CA-04.21: espeto na Cozinha e pastel na Fritadeira: cada estação só com o seu e "+ 1 item"', () => {
    const skewer = item({ id: 'a', quantity: 1 })
    const pastry = item({ id: 'b', productName: 'Pastel', quantity: 1, stationId: FRYER })
    const kitchen: CardMap = {}
    const fryer: CardMap = {}
    applyOrder(kitchen, order([skewer, pastry]), KITCHEN)
    applyOrder(fryer, order([skewer, pastry]), FRYER)
    expect(kitchen.o1!.lines.map((l) => l.productName)).toEqual(['Espeto de carne'])
    expect(kitchen.o1!.otherStationsQuantity).toBe(1)
    expect(fryer.o1!.lines.map((l) => l.productName)).toEqual(['Pastel'])
    expect(fryer.o1!.otherStationsQuantity).toBe(1)
  })

  it('order.created repetido (sala da unidade e da estação) não duplica o cartão', () => {
    const cards: CardMap = {}
    const only = order([item()])
    expect(applyOrder(cards, only, KITCHEN).arrived).toBe(true)
    expect(applyOrder(cards, only, KITCHEN).arrived).toBe(false)
    expect(cards.o1!.lines).toHaveLength(1)
  })

  it('CA-04.22: o segundo pedido da comanda é outro cartão, marcado como Adicional', () => {
    const cards: CardMap = { o1: card() }
    applyOrder(
      cards,
      order([item({ id: 'x', orderId: 'o2', orderNumberInTab: 2 })], { id: 'o2', numberInTab: 2 }),
      KITCHEN,
    )
    expect(Object.keys(cards).sort()).toEqual(['o1', 'o2'])
    expect(cards.o2!.isAdditional).toBe(true)
    expect(cards.o2!.numberInTab).toBe(2)
    expect(cards.o1!.lines).toHaveLength(1)
  })

  it('CA-04.23: linha cancelada fica riscada no cartão, com o motivo, e avisa', () => {
    const cards: CardMap = {
      o1: card({}, [item({ id: 'a' }), item({ id: 'b', productName: 'Kafta' })]),
    }
    const result = applyItem(
      cards,
      item({
        id: 'b',
        productName: 'Kafta',
        version: 1,
        canceledAt: '2026-10-01T20:03:00.000Z',
        cancelReason: 'cliente desistiu',
        stationId: null,
      }),
      KITCHEN,
    )
    expect(result.canceledHere).toBe(true)
    const line = cards.o1!.lines.find((l) => l.id === 'b')!
    expect(line.state).toBe('canceled')
    expect(line.cancelReason).toBe('cliente desistiu')
  })

  it('RN-04.45: tudo cancelado deixa o cartão com o "Ciente", inclusive depois da recarga', () => {
    const cards: CardMap = { o1: card() }
    const result = applyItem(
      cards,
      item({ version: 1, canceledAt: '2026-10-01T20:03:00.000Z', stationId: null }),
      KITCHEN,
    )
    expect(result.left).toBeNull()
    expect(cards.o1!.ackRequired).toBe(true)
    const reloaded = mergeReload(cards, [])
    expect(reloaded.cards.o1!.ackRequired).toBe(true)
    expect(reloaded.left).toEqual([])
  })

  it('avançar parte: a linha nova entra logo depois da original', () => {
    const cards: CardMap = { o1: card({}, [item({ quantity: 3 })]) }
    applyItem(cards, item({ quantity: 1, version: 1 }), KITCHEN)
    applyItem(
      cards,
      item({ id: 'i2', splitFromId: 'i1', quantity: 2, stationId: DELIVERY, stageId: 's3' }),
      KITCHEN,
    )
    expect(cards.o1!.lines.map((l) => [l.id, l.quantity, l.state])).toEqual([
      ['i1', 1, 'pending'],
      ['i2', 2, 'done'],
    ])
  })

  it('versão menor ou igual é ignorada', () => {
    const cards: CardMap = { o1: card({}, [item({ version: 3 })]) }
    expect(applyItem(cards, item({ version: 3, stageId: 's2' }), KITCHEN).changed).toBe(false)
  })

  it('recarga: cartão que sumiu sem "Ciente" vai para Recentes', () => {
    const previous: CardMap = { o1: card() }
    const { cards, left } = mergeReload(previous, [])
    expect(cards).toEqual({})
    expect(left.map((c) => c.orderId)).toEqual(['o1'])
  })
})

describe('grade e botão do cartão (spec 04, seção 8.2)', () => {
  it('CA-04.18: o pedido mais antigo vem primeiro (canto superior esquerdo)', () => {
    const cards = [
      card({ orderId: 'b', sentAt: '2026-10-01T20:10:00.000Z' }),
      card({ orderId: 'a', sentAt: '2026-10-01T20:00:00.000Z' }),
    ]
    expect(sortCards(cards).map((c) => c.orderId)).toEqual(['a', 'b'])
  })

  it('CA-04.17: rótulo "Começar" na primeira etapa, nome da etapa quando todas vão juntas, senão "Avançar tudo"', () => {
    expect(advanceLabel([{ stageId: 's1' }, { stageId: 's1' }], stages)).toBe('Começar')
    expect(advanceLabel([{ stageId: 's2' }], stages)).toBe('Pronto')
    expect(advanceLabel([{ stageId: 's1' }, { stageId: 's2' }], stages)).toBe('Avançar tudo')
  })

  it('com filtro por etapa, o botão avança só as linhas daquela etapa (RN-04.39)', () => {
    const mixed = card({}, [item({ id: 'a' }), item({ id: 'b', stageId: 's2' })])
    expect(linesToAdvance(mixed, null).map((l) => l.id)).toEqual(['a', 'b'])
    expect(linesToAdvance(mixed, 's2').map((l) => l.id)).toEqual(['b'])
    expect(notStarted(mixed, stages)).toBe(false)
    expect(notStarted(card(), stages)).toBe(true)
  })
})

describe('tempo do cartão (RN-04.46)', () => {
  it('CA-04.24: atenção em 7 e atraso em 15; atenção em 10 volta o cartão de 8 min ao normal', () => {
    const at = (minutes: number) => Date.parse(sentAt) + minutes * 60_000
    expect(timeLevel(sentAt, limits, at(5))).toBe('normal')
    expect(timeLevel(sentAt, limits, at(8))).toBe('attention')
    expect(timeLevel(sentAt, limits, at(16))).toBe('late')
    expect(timeLevel(sentAt, { attentionAfterMinutes: 10, lateAfterMinutes: 15 }, at(8))).toBe(
      'normal',
    )
  })

  it('relógio do cartão em mm:ss e h:mm depois de uma hora', () => {
    expect(clockLabel(sentAt, Date.parse(sentAt) + 65_000)).toBe('01:05')
    expect(clockLabel(sentAt, Date.parse(sentAt) + 3_725_000)).toBe('1:02')
  })

  it('contadores por etapa e por nível, que também filtram', () => {
    const now = Date.parse(sentAt) + 8 * 60_000
    const list = [
      card({ orderId: 'a' }),
      card({ orderId: 'b' }, [item({ id: 'x', orderId: 'b', stageId: 's2' })]),
    ]
    const entries = counters(list, stages.slice(0, 2), {
      limits,
      now,
      isNew: (c) => c.orderId === 'a',
    })
    expect(entries.map((e) => `${e.label} ${e.count}`)).toEqual([
      'Todos 2',
      'Novos 1',
      'Recebido 1',
      'Preparando 1',
      'Atenção 2',
    ])
  })
})

describe('limites da estação (RN-03.25)', () => {
  it('CA-03.12: estação nova com atraso 15 nasce com atenção 7; atenção ≥ atraso é recusada', () => {
    expect(defaultLimits(15)).toEqual({ attentionAfterMinutes: 7, lateAfterMinutes: 15 })
    expect(timeLimitsError(7, 15)).toBeNull()
    expect(timeLimitsError(15, 15)).toMatch(/antes do atraso/)
    expect(timeLimitsError(0, 15)).toMatch(/pelo menos 1/)
    expect(timeLimitsError(5, 241)).toMatch(/1 a 240/)
  })
})

describe('Recentes (spec 04, seção 8.2)', () => {
  it('guarda as linhas feitas, sem repetir pedido, até 10', () => {
    const done = card({}, [item({ stationId: DELIVERY, stageId: 's3' })])
    let list = pushRecent([], recentFrom(done, 1))
    list = pushRecent(list, recentFrom(done, 2))
    expect(list).toHaveLength(1)
    expect(list[0]!.lines.map((l) => l.state)).toEqual(['done'])
    for (let n = 0; n < 12; n += 1) {
      list = pushRecent(list, recentFrom(card({ orderId: `o${n}` }), n))
    }
    expect(list).toHaveLength(10)
  })
})

// Garante que o tipo do fixture continua igual ao da fila da API.
export const _shape: StationOrder = card()
