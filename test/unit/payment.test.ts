import { describe, expect, it } from 'vitest'
import {
  actorLabel,
  addPaymentLabel,
  applyDraftPayments,
  cashChange,
  closingRows,
  confirmPaymentLabel,
  countsOf,
  differenceLabel,
  discountCents,
  discountLabel,
  discountedTotal,
  hasDifference,
  paymentIdsOf,
  paymentIssue,
  pressKey,
  registersOf,
  toPayFirstBody,
  toPaymentBody,
} from '../../app/lib/payment'

const register = {
  expected: [
    { method: 'cash' as const, expectedCents: 25_000 },
    { method: 'pix' as const, expectedCents: 5_000 },
    { method: 'credit_card' as const, expectedCents: 0 },
    { method: 'debit_card' as const, expectedCents: 1_200 },
  ],
}

describe('troco no dinheiro (RN-05.09)', () => {
  it('CA-05.02: R$ 46,00 com R$ 50,00 entregues aplica R$ 46,00 e devolve R$ 4,00', () => {
    expect(cashChange(5_000, 4_600)).toEqual({ appliedCents: 4_600, changeCents: 400 })
  })

  it('entregue menor que o saldo: aplica tudo, sem troco', () => {
    expect(cashChange(3_000, 8_000)).toEqual({ appliedCents: 3_000, changeCents: 0 })
  })

  it('valor exato: sem troco; saldo zero devolve tudo', () => {
    expect(cashChange(4_600, 4_600)).toEqual({ appliedCents: 4_600, changeCents: 0 })
    expect(cashChange(1_000, 0)).toEqual({ appliedCents: 0, changeCents: 1_000 })
  })
})

describe('validação do pagamento (RN-05.08)', () => {
  it('CA-05.03: Pix e cartões não passam do saldo', () => {
    expect(paymentIssue('pix', 5_001, 5_000)).toContain('não pode passar do saldo')
    expect(paymentIssue('credit_card', 5_000, 5_000)).toBeNull()
  })

  it('dinheiro pode passar do saldo (vira troco); zero e saldo zerado são recusados', () => {
    expect(paymentIssue('cash', 10_000, 4_600)).toBeNull()
    expect(paymentIssue('cash', 0, 4_600)).toBe('Digite o valor entregue.')
    expect(paymentIssue('pix', 100, 0)).toBe('Não há saldo a receber.')
  })

  it('botão de confirmação mostra valor e forma (spec 08, seção 6)', () => {
    expect(confirmPaymentLabel('pix', 4_600)).toBe('Confirmar R$ 46,00 no Pix')
    expect(confirmPaymentLabel('cash', 3_000)).toBe('Confirmar R$ 30,00 no dinheiro')
    expect(addPaymentLabel('debit_card', 2_000)).toBe('Adicionar R$ 20,00 no débito')
  })
})

describe('teclado numérico', () => {
  it('os dígitos entram pela direita, em centavos', () => {
    let cents = 0
    for (const key of ['4', '6', '0', '0'] as const) cents = pressKey(cents, key)
    expect(cents).toBe(4_600)
    expect(pressKey(46, '00')).toBe(4_600)
    expect(pressKey(4_600, 'back')).toBe(460)
  })

  it('não passa do máximo aceito', () => {
    expect(pressKey(9_999_999, '9')).toBe(9_999_999)
  })
})

describe('desconto (RN-05.01 a 05.03)', () => {
  it('CA-05.04: 10% sobre R$ 92,50 dá total de R$ 83,25', () => {
    expect(discountCents(9_250, 'percent', 10)).toBe(925)
    expect(discountedTotal(9_250, 'percent', 10)).toBe(8_325)
  })

  it('percentual arredonda o desconto para baixo em centavos', () => {
    // 15% de R$ 33,33 = 4,9995 → 4,99
    expect(discountCents(3_333, 'percent', 15)).toBe(499)
  })

  it('valor maior que o subtotal zera o total, nunca negativo', () => {
    expect(discountedTotal(1_000, 'amount', 5_000)).toBe(0)
    expect(discountedTotal(1_000, 'percent', 100)).toBe(0)
  })

  it('texto do desconto', () => {
    expect(discountLabel('percent', 10)).toBe('10%')
    expect(discountLabel('amount', 500)).toBe('R$ 5,00')
    expect(discountLabel(null, null)).toBe('')
  })
})

describe('paga antes (RN-05.12)', () => {
  it('aplica os pagamentos na ordem e calcula o troco do dinheiro', () => {
    const result = applyDraftPayments(8_000, [
      { method: 'pix', cents: 5_000 },
      { method: 'cash', cents: 5_000 },
    ])
    expect(result.lines.map((line) => line.appliedCents)).toEqual([5_000, 3_000])
    expect(result.changeCents).toBe(2_000)
    expect(result.remainingCents).toBe(0)
    expect(result.covered).toBe(true)
  })

  it('CA-05.09: soma menor que o total não cobre (a tela não envia)', () => {
    const result = applyDraftPayments(8_000, [{ method: 'pix', cents: 5_000 }])
    expect(result.covered).toBe(false)
    expect(result.remainingCents).toBe(3_000)
  })

  it('monta o corpo do pay-first: dinheiro com entregue, demais com valor', () => {
    const body = toPayFirstBody({
      customerName: 'Lucas',
      items: [{ productId: 'p1', quantity: 2, modifierIds: [], note: null }],
      payments: [
        { method: 'pix', cents: 2_000 },
        { method: 'cash', cents: 5_000 },
      ],
      cashRegisterId: 'r1',
    })
    expect(body).toEqual({
      customerName: 'Lucas',
      items: [{ productId: 'p1', quantity: 2, modifierIds: [], note: null }],
      payments: [
        { method: 'pix', amountCents: 2_000 },
        { method: 'cash', tenderedCents: 5_000 },
      ],
      cashRegisterId: 'r1',
    })
    expect(toPayFirstBody({ customerName: 'A', items: [], payments: [] })).not.toHaveProperty(
      'cashRegisterId',
    )
  })

  it('corpo do pagamento da comanda aberta (RN-05.05)', () => {
    expect(toPaymentBody('cash', 5_000, null)).toEqual({ method: 'cash', tenderedCents: 5_000 })
    expect(toPaymentBody('pix', 4_600, 'r2')).toEqual({
      method: 'pix',
      amountCents: 4_600,
      cashRegisterId: 'r2',
    })
  })
})

describe('fechamento do caixa (RN-05.20)', () => {
  it('calcula a diferença de cada forma (informado − esperado)', () => {
    const rows = closingRows(register, {
      cash: 24_500,
      pix: 5_000,
      credit_card: 0,
      debit_card: null,
    })
    expect(rows.map((row) => [row.method, row.differenceCents])).toEqual([
      ['cash', -500],
      ['pix', 0],
      ['credit_card', 0],
      ['debit_card', null],
    ])
    expect(hasDifference(rows)).toBe(true)
  })

  it('CA-05.07: sem diferença, a observação não é obrigatória', () => {
    const rows = closingRows(register, {
      cash: 25_000,
      pix: 5_000,
      credit_card: 0,
      debit_card: 1_200,
    })
    expect(hasDifference(rows)).toBe(false)
  })

  it('diferença sempre com texto', () => {
    expect(differenceLabel(0)).toBe('Confere')
    expect(differenceLabel(200)).toBe('Sobra R$ 2,00')
    expect(differenceLabel(-500)).toBe('Falta R$ 5,00')
  })
})

describe('detalhes dos erros da spec 05', () => {
  it('lê caixas, pagamentos e a prévia das diferenças', () => {
    expect(registersOf({ cashRegisters: [{ id: 'a', name: 'Caixa 1' }] })).toEqual([
      { id: 'a', name: 'Caixa 1' },
    ])
    expect(paymentIdsOf({ paymentIds: ['p'] })).toEqual(['p'])
    expect(countsOf({})).toEqual([])
    expect(registersOf(undefined)).toEqual([])
  })

  it('responsável do caixa (RN-05.17)', () => {
    const me = { type: 'staff' as const, id: 's1' }
    expect(actorLabel({ type: 'staff', id: 's1' }, me)).toBe('Você')
    expect(actorLabel({ type: 'owner', id: 'o' }, me)).toBe('Dono')
    expect(actorLabel({ type: 'staff', id: 's2' }, me, { s2: 'Ana' })).toBe('Ana')
    expect(actorLabel({ type: 'staff', id: 's3' }, me)).toBe('Colaborador')
  })
})
