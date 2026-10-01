import { describe, expect, it } from 'vitest'
import { MAX_CENTS, centsToInput, formatCents, formatDelta, parseReais } from '../../app/lib/money'

const nbsp = ' '

describe('dinheiro em centavos (regras comuns; RN-03.09)', () => {
  it('formata centavos como reais, só com inteiros', () => {
    expect(formatCents(1250)).toBe(`R$${nbsp}12,50`)
    expect(formatCents(0)).toBe(`R$${nbsp}0,00`)
    expect(formatCents(5)).toBe(`R$${nbsp}0,05`)
    expect(formatCents(123456789)).toBe(`R$${nbsp}1.234.567,89`)
    expect(formatDelta(0)).toBe('sem acréscimo')
    expect(formatDelta(300)).toBe(`+ R$${nbsp}3,00`)
  })

  it('preenche o campo em reais', () => {
    expect(centsToInput(1250)).toBe('12,50')
    expect(centsToInput(7)).toBe('0,07')
    expect(centsToInput(100000)).toBe('1000,00')
  })

  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,07', 7],
    [',5', 50],
    ['1.234,56', 123456],
    ['R$ 12,00', 1200],
    ['  9,9 ', 990],
    ['12.50', 1250],
    ['12.5', 1250],
    ['1.234', 123400],
    ['0', 0],
  ])('lê "%s" como %i centavos', (input, cents) => {
    expect(parseReais(input)).toBe(cents)
  })

  it.each(['', 'abc', '-5', '12,345', '1,2,3', '12.345,6.7', '1.23.4', '12,5a', '.'])(
    'recusa "%s"',
    (input) => {
      expect(parseReais(input)).toBeNull()
    },
  )

  it('nunca passa por ponto flutuante: 0,29 + 0,01 dá 30 centavos exatos', () => {
    expect(parseReais('0,29')! + parseReais('0,01')!).toBe(30)
    expect(parseReais('1,15')).toBe(115)
  })

  it('recusa valores acima do teto', () => {
    expect(parseReais(centsToInput(MAX_CENTS))).toBe(MAX_CENTS)
    expect(parseReais('100.000,00')).toBeNull()
  })

  it('ida e volta preserva o valor', () => {
    for (const cents of [0, 1, 99, 100, 1999, 123456]) {
      expect(parseReais(centsToInput(cents))).toBe(cents)
    }
  })
})
