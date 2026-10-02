import { describe, expect, it } from 'vitest'
import {
  closeCashTarget,
  homeAction,
  openCashTarget,
  tabsCountLabel,
  unitStatusLabel,
} from '../../app/lib/home'
import {
  REGISTER,
  cashRegister,
  closedRegister,
  unitOperation,
} from '../support/operation-fixtures'

// Spec 01, seção 14.2 (RN-01.24): uma ação principal conforme a situação da unidade.

describe('início do painel orientado à tarefa (RN-01.24)', () => {
  it('CA-01.18: sem caixa aberto, a ação é "Abrir caixa" (um caixa vai direto à abertura dele)', () => {
    const action = homeAction(unitOperation({ cashRegisters: [closedRegister()] }))
    expect(action).toEqual({ kind: 'open-cash', target: `/caixas/${REGISTER}/abrir` })
  })

  it('com mais de um caixa cadastrado, "Abrir caixa" leva à lista', () => {
    const two = [closedRegister(), closedRegister({ id: 'r2', name: 'Caixa 2', sortOrder: 2 })]
    expect(openCashTarget(two)).toBe('/caixas')
    expect(openCashTarget([...two.slice(0, 1), { ...two[1]!, active: false }])).toBe(
      `/caixas/${REGISTER}/abrir`,
    )
  })

  it('CA-01.18: com caixa aberto, a ação passa a ser "Abrir balcão"', () => {
    const action = homeAction(unitOperation())
    expect(action.kind).toBe('open-counter')
    expect(closeCashTarget(unitOperation().cashRegisters)).toBe(`/caixas/${REGISTER}/fechar`)
  })

  it('RN-05.26: caixa aberto desde ontem pede para fechar primeiro', () => {
    const open = cashRegister()
    const earlier = {
      ...open,
      session: { ...open.session!, openSinceEarlierDay: true, openedAt: '2026-10-01T20:02:00Z' },
    }
    const action = homeAction(
      unitOperation({ cashRegisters: [earlier] }),
      Date.parse('2026-10-02T15:00:00-03:00'),
    )
    expect(action).toMatchObject({ kind: 'close-earlier', since: 'ontem, 17:02' })
  })

  it('resumo de uma linha por unidade e contagens', () => {
    expect(unitStatusLabel(unitOperation())).toBe('caixa aberto')
    expect(unitStatusLabel(unitOperation({ cashRegisters: [closedRegister()] }))).toBe(
      'caixa fechado',
    )
    expect(unitStatusLabel(null)).toBe('carregando…')
    expect(tabsCountLabel(1)).toBe('1 comanda')
    expect(tabsCountLabel(3)).toBe('3 comandas')
  })
})
