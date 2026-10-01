import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import DiscountForm from '~/components/DiscountForm.vue'
import PaymentPad from '~/components/PaymentPad.vue'
import RegisterPicker from '~/components/RegisterPicker.vue'
import TabBoard from '~/components/TabBoard.vue'
import TabItemRow from '~/components/TabItemRow.vue'
import { createTabBoard } from '~/lib/live-collection'
import type { CashRegister } from '~/lib/payment'
import { SHIFT, item, stages, tabSummary } from '../support/operation-fixtures'

const now = Date.parse('2026-10-01T20:05:00.000Z')

function register(overrides: Partial<CashRegister> = {}): CashRegister {
  return {
    id: 'r1',
    shiftId: 'sh',
    unitId: 'u',
    name: 'Caixa 1',
    status: 'open',
    openingFloatCents: 10_000,
    openedBy: { type: 'staff', id: 's1' },
    openedAt: '2026-10-01T19:00:00.000Z',
    closedBy: null,
    closedAt: null,
    closingNote: null,
    expected: [],
    cash: {
      openingFloatCents: 10_000,
      paymentsCents: 0,
      creditSettlementsCents: 0,
      depositsCents: 0,
      withdrawalsCents: 0,
    },
    creditSettlementsCents: 0,
    counts: [],
    version: 0,
    ...overrides,
  }
}

describe('teclado de receber (spec 05, seção 8)', () => {
  it('Pix começa no saldo; o primeiro dígito substitui o valor', async () => {
    const pad = await mountSuspended(PaymentPad, {
      props: { balanceCents: 8_000, method: null, cents: 0 },
    })
    await pad.get('[data-testid="method-pix"]').trigger('click')
    expect(pad.emitted('update:method')?.at(-1)).toEqual(['pix'])
    expect(pad.emitted('update:cents')?.at(-1)).toEqual([8_000])
    await pad.setProps({ method: 'pix', cents: 8_000 })
    await pad.get('[data-testid="key-5"]').trigger('click')
    expect(pad.emitted('update:cents')?.at(-1)).toEqual([5])
  })

  it('CA-05.02: no dinheiro mostra o valor entregue e o troco em destaque', async () => {
    const pad = await mountSuspended(PaymentPad, {
      props: { balanceCents: 4_600, method: 'cash', cents: 5_000 },
    })
    expect(pad.text()).toContain('Valor entregue')
    expect(pad.get('[data-testid="change"]').text()).toBe('R$ 4,00')
    expect(pad.text()).toContain('Entra na comanda: R$ 46,00')
  })

  it('CA-05.03: Pix acima do saldo mostra o aviso na linha reservada', async () => {
    const pad = await mountSuspended(PaymentPad, {
      props: { balanceCents: 3_000, method: 'pix', cents: 5_000 },
    })
    expect(pad.get('[data-testid="pad-issue"]').text()).toContain('não pode passar do saldo')
  })
})

describe('desconto (RN-05.01 a 05.03)', () => {
  it('CA-05.04: prévia de 10% sobre R$ 92,50 e motivo obrigatório', async () => {
    const form = await mountSuspended(DiscountForm, {
      props: { subtotalCents: 9_250, paidCents: 0, current: null },
    })
    await form.findAll('button[aria-pressed]')[1]!.trigger('click')
    await form.get('input[inputmode="numeric"]').setValue('10')
    expect(form.get('[data-testid="discount-preview-total"]').text()).toBe('R$ 83,25')
    await form.get('[data-testid="apply-discount"]').trigger('submit')
    expect(form.text()).toContain('Diga o motivo do desconto.')
    expect(form.emitted('apply')).toBeUndefined()
    const inputs = form.findAll('input')
    await inputs.at(-1)!.setValue('cliente da casa')
    await form.get('form').trigger('submit')
    expect(form.emitted('apply')?.[0]).toEqual([
      { type: 'percent', value: 10, reason: 'cliente da casa', description: '10%' },
    ])
  })

  it('total abaixo do já pago é bloqueado (RN-05.14)', async () => {
    const form = await mountSuspended(DiscountForm, {
      props: { subtotalCents: 5_000, paidCents: 4_000, current: null },
    })
    await form.get('input[inputmode="decimal"]').setValue('20,00')
    expect(form.text()).toContain('O total ficaria abaixo do que já foi pago')
  })

  it('com desconto atual, oferece substituir e remover com motivo', async () => {
    const form = await mountSuspended(DiscountForm, {
      props: {
        subtotalCents: 5_000,
        paidCents: 0,
        current: { type: 'amount', value: 500, reason: 'amigo' },
      },
    })
    expect(form.text()).toContain('Desconto atual: R$ 5,00')
    expect(form.get('[data-testid="apply-discount"]').text()).toBe('Substituir desconto')
    const removeForm = form.findAll('form')[1]!
    await removeForm.trigger('submit')
    expect(form.text()).toContain('Diga o motivo da remoção.')
    await removeForm.get('input').setValue('engano')
    await removeForm.trigger('submit')
    expect(form.emitted('remove')?.[0]).toEqual(['engano'])
  })
})

describe('escolha do caixa (RN-05.05, RN-05.06)', () => {
  it('CA-05.08: sem caixa aberto orienta "Abra um caixa para receber"', async () => {
    const picker = await mountSuspended(RegisterPicker, {
      props: { registers: [], selectedId: null, loaded: true, canOpen: true, unitId: 'u' },
    })
    expect(picker.text()).toContain('Abra um caixa para receber.')
    expect(picker.get('a').attributes('href')).toBe('/caixas?unidade=u')
  })

  it('com mais de um caixa, pede a escolha', async () => {
    const picker = await mountSuspended(RegisterPicker, {
      props: {
        registers: [register(), register({ id: 'r2', name: 'Caixa 2' })],
        selectedId: null,
        loaded: true,
      },
    })
    expect(picker.findAll('[data-testid="register-option"]')).toHaveLength(2)
    expect(picker.text()).toContain('Escolha o caixa antes de receber.')
    await picker.findAll('[data-testid="register-option"]')[1]!.trigger('click')
    expect(picker.emitted('choose')?.[0]).toEqual(['r2'])
  })

  it('com um caixa só, nada a escolher', async () => {
    const picker = await mountSuspended(RegisterPicker, {
      props: { registers: [register()], selectedId: 'r1', loaded: true },
    })
    expect(picker.text()).toBe('')
  })
})

describe('cancelar item de comanda paga (RN-04.28, RN-05.14)', () => {
  it('explica o roteiro estornar → cancelar → receber de novo, sem abrir o cancelamento', async () => {
    const row = await mountSuspended(TabItemRow, {
      props: { item: item(), stages, now, editable: true, paidTabNumber: 7 },
    })
    await row.get('[data-testid="cancel-item"]').trigger('click')
    const guide = row.get('[data-testid="paid-cancel-guide"]')
    expect(guide.text()).toContain('Esta comanda já está paga.')
    expect(guide.text()).toContain('Estorne o pagamento')
    expect(guide.get('a').attributes('href')).toBe('/balcao/comandas/7/receber')
    expect(row.find('form').exists()).toBe(false)
  })
})

describe('estado honesto sem conexão (spec 01, seção 11)', () => {
  function queued(meta: unknown, attempts = 1) {
    return {
      seq: 1,
      idempotencyKey: `k-${Math.random()}`,
      method: 'POST' as const,
      path: '/x',
      label: 'x',
      meta,
      createdAt: 0,
      attempts,
      nextAttemptAt: 0,
      status: 'pending' as const,
    }
  }

  it('paga antes na fila aparece no varal como não confirmada; pagamento na fila não muda a comanda', async () => {
    const counter = useCounterStore()
    const connection = useConnectionStore()
    counter.board = createTabBoard(SHIFT)
    counter.board.apply(tabSummary({ status: 'closing', balanceCents: 3_600 }))
    connection.online = false
    connection.pending = [
      queued({
        kind: 'tab.pay_first',
        shiftId: SHIFT,
        customerName: 'Lucas',
        draftKey: `pay-first:${SHIFT}`,
        lines: [],
        payments: [{ method: 'pix', cents: 1_800 }],
        totalCents: 1_800,
      }),
      queued({
        kind: 'tab.payment',
        tabId: 't1',
        tabNumber: 12,
        method: 'pix',
        cents: 3_600,
        changeCents: 0,
        cashRegisterId: null,
      }),
    ]
    const board = await mountSuspended(TabBoard)
    await board.findAll('button[aria-pressed]')[1]!.trigger('click')
    const queuedCard = board.get('[data-testid="queued-tab"]')
    expect(queuedCard.text()).toContain('Lucas')
    expect(queuedCard.text()).toContain('pagamento ainda não confirmado')
    expect(queuedCard.text()).toContain('Na fila')
    const card = board.get('[data-testid="tab-card"]')
    // A comanda continua "Fechando", com o pagamento só como pendente.
    expect(card.text()).toContain('Fechando')
    expect(card.text()).toContain('Pagamento: Na fila')
    connection.pending = []
    connection.online = true
  })
})
