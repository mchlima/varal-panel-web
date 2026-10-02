import { describe, expect, it } from 'vitest'
import {
  LiveCollection,
  applyItemToTab,
  createRegisterList,
  createTabBoard,
} from '../../app/lib/live-collection'
import type { OrderItem } from '../../app/lib/operation'
import {
  DELIVERY,
  KITCHEN,
  UNIT,
  cashRegister,
  item,
  tab,
  tabSummary,
} from '../support/operation-fixtures'

/** Coleção de itens de uma estação, para testar as regras de versão. */
function itemsAt(stationId: string) {
  return new LiveCollection<OrderItem>(
    (record) => record.stationId === stationId && record.canceledAt === null,
  )
}

describe('eventos aplicados por versão (spec 01, seção 10; RN-01.05)', () => {
  it('ignora evento com version menor ou igual à conhecida', () => {
    const queue = itemsAt(KITCHEN)
    queue.finishReload([item({ version: 2, stageName: 'Preparando', stageId: 's2' })])
    expect(queue.apply(item({ version: 2, stageName: 'Recebido' }))).toBe(false)
    expect(queue.apply(item({ version: 1 }))).toBe(false)
    expect(queue.items.i1!.stageName).toBe('Preparando')
    expect(queue.apply(item({ version: 3, stageName: 'Preparando', quantity: 1 }))).toBe(true)
    expect(queue.items.i1!.quantity).toBe(1)
  })

  it('registro que deixa de pertencer sai e um evento atrasado não o traz de volta', () => {
    const queue = itemsAt(KITCHEN)
    queue.finishReload([item({ version: 1 })])
    queue.apply(item({ version: 2, stageId: 's3', stageName: 'Pronto', stationId: DELIVERY }))
    expect(queue.list()).toHaveLength(0)
    queue.apply(item({ version: 0 }))
    expect(queue.list()).toHaveLength(0)
  })

  it('CA-04.12: eventos que chegam durante a busca por REST são aplicados depois dela', () => {
    const queue = itemsAt(KITCHEN)
    queue.finishReload([item({ id: 'old', version: 0 })])
    queue.beginReload()
    expect(queue.apply(item({ id: 'new', version: 0 }))).toBe(false)
    queue.apply(item({ id: 'a', version: 5, stageId: 's2', stageName: 'Preparando' }))
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

  it('sem duplicar: o mesmo registro recebido de novo fica uma vez', () => {
    const queue = itemsAt(KITCHEN)
    queue.finishReload([])
    queue.apply(item())
    queue.apply(item())
    expect(queue.list()).toHaveLength(1)
  })
})

describe('comanda aberta na tela (RN-04.24, CA-04.13)', () => {
  it('a linha nova entra logo depois da original e o total não muda', () => {
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
    expect(applyItemToTab(detail, { ...original, version: 1 })).toBe(false)
  })
})

describe('varal de comandas (RN-04.07)', () => {
  it('mostra abertas e fechando da unidade, de qualquer dia; paga ou cancelada sai', () => {
    const board = createTabBoard(UNIT)
    board.finishReload([
      tabSummary(),
      tabSummary({ id: 't2', number: 13, status: 'closing', businessDate: '2026-09-30' }),
    ])
    expect(board.list()).toHaveLength(2)
    board.apply(tabSummary({ id: 't2', number: 13, status: 'canceled', version: 1 }))
    expect(board.list().map((t) => t.number)).toEqual([12])
    board.apply(tabSummary({ id: 't3', number: 14, unitId: 'outra' }))
    expect(board.list()).toHaveLength(1)
  })
})

describe('caixas da unidade (spec 05, seção 5)', () => {
  it('aplica o caixa por versão e ignora caixa de outra unidade', () => {
    const list = createRegisterList(UNIT)
    list.finishReload([cashRegister({ version: 2 })])
    expect(list.apply(cashRegister({ version: 1, name: 'Velho' }))).toBe(false)
    expect(list.apply(cashRegister({ version: 3, name: 'Balcão' }))).toBe(true)
    expect(list.list().map((r) => r.name)).toEqual(['Balcão'])
    list.apply(cashRegister({ id: 'x', unitId: 'outra', version: 1 }))
    expect(list.list()).toHaveLength(1)
  })
})
