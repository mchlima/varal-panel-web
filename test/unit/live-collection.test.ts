import { describe, expect, it } from 'vitest'
import {
  applyItemToTab,
  compareQueueItems,
  createStationQueue,
  createTabBoard,
} from '../../app/lib/live-collection'
import { DELIVERY, KITCHEN, SHIFT, item, tab, tabSummary } from '../support/operation-fixtures'

describe('eventos aplicados por versão (spec 01, seção 10; RN-01.05)', () => {
  it('ignora evento com version menor ou igual à conhecida', () => {
    const queue = createStationQueue(KITCHEN)
    queue.finishReload([item({ version: 2, stageName: 'Preparando', stageId: 's2' })])
    expect(queue.apply(item({ version: 2, stageName: 'Recebido' }))).toBe(false)
    expect(queue.apply(item({ version: 1 }))).toBe(false)
    expect(queue.items.i1!.stageName).toBe('Preparando')
    expect(queue.apply(item({ version: 3, stageName: 'Preparando', quantity: 1 }))).toBe(true)
    expect(queue.items.i1!.quantity).toBe(1)
  })

  it('item que vai para outra estação sai da fila e um evento atrasado não o traz de volta', () => {
    const queue = createStationQueue(KITCHEN)
    queue.finishReload([item({ version: 1 })])
    queue.apply(item({ version: 2, stageId: 's3', stageName: 'Pronto', stationId: DELIVERY }))
    expect(queue.list()).toHaveLength(0)
    // order.created atrasado, com a versão do envio.
    queue.apply(item({ version: 0 }))
    expect(queue.list()).toHaveLength(0)
  })

  it('item cancelado sai da fila', () => {
    const queue = createStationQueue(KITCHEN)
    queue.finishReload([item({ version: 1 })])
    queue.apply(item({ version: 2, canceledAt: '2026-10-01T20:05:00.000Z', stationId: null }))
    expect(queue.list()).toHaveLength(0)
  })

  it('CA-04.12: eventos que chegam durante a busca por REST são aplicados depois dela', () => {
    const queue = createStationQueue(KITCHEN)
    queue.finishReload([item({ id: 'old', version: 0 })])
    queue.beginReload()
    // Durante a busca: um item novo e uma mudança mais nova que o REST.
    expect(queue.apply(item({ id: 'new', version: 0 }))).toBe(false)
    queue.apply(item({ id: 'a', version: 5, stageId: 's2', stageName: 'Preparando' }))
    // O REST, buscado antes desses eventos, não conhece "new" e tem "a" na versão 4.
    queue.finishReload([item({ id: 'a', version: 4 })])
    expect(
      queue
        .list()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['a', 'new'])
    expect(queue.items.a!.stageName).toBe('Preparando')
    expect('old' in queue.items).toBe(false)
  })

  it('sem duplicar: o mesmo item recebido de novo (sala da unidade e da estação) fica uma vez', () => {
    const queue = createStationQueue(KITCHEN)
    queue.finishReload([])
    queue.apply(item())
    queue.apply(item())
    expect(queue.list()).toHaveLength(1)
  })
})

describe('avançar parte (RN-04.24, CA-04.13)', () => {
  it('na estação de origem a linha original fica com o resto; a nova vai para a próxima', () => {
    const kitchen = createStationQueue(KITCHEN)
    const delivery = createStationQueue(DELIVERY)
    const original = item({ quantity: 3, version: 1, stageId: 's2', stageName: 'Preparando' })
    kitchen.finishReload([original])
    delivery.finishReload([])

    // Evento order_item.stage_changed: item = linha nova (2 em Pronto), remaining = original (1).
    const moved = item({
      id: 'i2',
      splitFromId: 'i1',
      quantity: 2,
      stageId: 's3',
      stageName: 'Pronto',
      stationId: DELIVERY,
      version: 0,
    })
    const remaining = { ...original, quantity: 1, version: 2 }
    for (const queue of [kitchen, delivery]) {
      queue.apply(moved)
      queue.apply(remaining)
    }
    expect(kitchen.list().map((i) => [i.id, i.quantity])).toEqual([['i1', 1]])
    expect(delivery.list().map((i) => [i.id, i.quantity])).toEqual([['i2', 2]])
  })

  it('na comanda, a linha nova entra logo depois da original e o total não muda', () => {
    const original = item({ quantity: 3, totalCents: 3600, version: 1 })
    const other = item({ id: 'i9', productName: 'Kafta', totalCents: 1100, quantity: 1 })
    const detail = tab({}, [original, other])
    applyItemToTab(detail, { ...original, quantity: 1, totalCents: 1200, version: 2 })
    applyItemToTab(
      detail,
      item({ id: 'i2', splitFromId: 'i1', quantity: 2, totalCents: 2400, stageName: 'Pronto' }),
    )
    const lines = detail.orders[0]!.items
    expect(lines.map((i) => i.id)).toEqual(['i1', 'i2', 'i9'])
    expect(lines.reduce((sum, i) => sum + i.totalCents, 0)).toBe(3600 + 1100)
    // Versão velha não volta atrás.
    expect(applyItemToTab(detail, { ...original, version: 1 })).toBe(false)
  })
})

describe('ordem da fila (spec 04, seção 8.2)', () => {
  it('pedido mais antigo primeiro, itens do mesmo pedido juntos, linha dividida logo após a original', () => {
    const items = [
      item({ id: 'b1', orderId: 'ob', sentAt: '2026-10-01T20:10:00.000Z' }),
      item({ id: 'a2', orderId: 'oa', sentAt: '2026-10-01T20:00:00.000Z' }),
      item({ id: 'z', orderId: 'oa', splitFromId: 'a1', sentAt: '2026-10-01T20:00:00.000Z' }),
      item({ id: 'a1', orderId: 'oa', sentAt: '2026-10-01T20:00:00.000Z' }),
    ]
    expect(items.sort(compareQueueItems).map((i) => i.id)).toEqual(['a1', 'z', 'a2', 'b1'])
  })
})

describe('varal de comandas', () => {
  it('mostra abertas e fechando do turno; paga ou cancelada sai', () => {
    const board = createTabBoard(SHIFT)
    board.finishReload([tabSummary(), tabSummary({ id: 't2', number: 13, status: 'closing' })])
    expect(board.list()).toHaveLength(2)
    board.apply(tabSummary({ id: 't2', number: 13, status: 'canceled', version: 1 }))
    expect(board.list().map((t) => t.number)).toEqual([12])
    board.apply(tabSummary({ id: 't3', number: 14, shiftId: 'outro' }))
    expect(board.list()).toHaveLength(1)
  })
})
