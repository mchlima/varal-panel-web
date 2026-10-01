import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProductOptions from '~/components/ProductOptions.vue'
import QueueItemCard from '~/components/QueueItemCard.vue'
import TabItemRow from '~/components/TabItemRow.vue'
import type { CartLine } from '~/lib/order-builder'
import { item, skewer, stages } from '../support/operation-fixtures'

const now = Date.parse('2026-10-01T20:05:00.000Z')

describe('cartão de item da estação (spec 04, seção 8.2)', () => {
  it('mostra quantidade, produto, modificadores, observação, comanda e o botão da próxima etapa', async () => {
    const card = await mountSuspended(QueueItemCard, {
      props: {
        item: item({
          note: 'sem sal',
          modifiers: [
            {
              modifierId: 'm',
              groupName: 'Ponto da carne',
              modifierName: 'Ao ponto',
              priceDeltaCents: 0,
            },
          ],
        }),
        stages,
        now,
        fresh: true,
      },
    })
    const text = card.text()
    expect(text).toContain('3×')
    expect(text).toContain('Espeto de carne')
    expect(text).toContain('Ao ponto')
    expect(text).toContain('Obs.: sem sal')
    expect(text).toContain('Dona Marta')
    expect(text).toContain('Novo')
    expect(text).toContain('há 5 min')
    expect(card.get('[data-testid="advance"]').text()).toContain('Preparando')
  })

  it('RN-04.24: avançar parte escolhe quantas de N seguem', async () => {
    const card = await mountSuspended(QueueItemCard, { props: { item: item(), stages, now } })
    await card.get('[data-testid="item-menu"]').trigger('click')
    await card.get('[data-testid="advance-part"]').trigger('click')
    expect(card.findAll('[data-testid^="advance-"]').map((b) => b.text())).toEqual(['1', '2', '3'])
    await card.get('[data-testid="advance-2"]').trigger('click')
    expect(card.emitted('advance')).toEqual([[2]])
  })

  it('um toque avança tudo; item com 1 unidade não oferece avançar parte', async () => {
    const card = await mountSuspended(QueueItemCard, {
      props: { item: item({ quantity: 1 }), stages, now },
    })
    await card.get('[data-testid="advance"]').trigger('click')
    expect(card.emitted('advance')).toEqual([[1]])
    await card.get('[data-testid="item-menu"]').trigger('click')
    expect(card.find('[data-testid="advance-part"]').exists()).toBe(false)
  })

  it('CA-04.11: atrasado pelo relógio do aparelho, com os minutos', async () => {
    const card = await mountSuspended(QueueItemCard, {
      props: { item: item({ isLate: false }), stages, now: Date.parse('2026-10-01T20:20:00.000Z') },
    })
    expect(card.text()).toContain('Atrasado · 20 min')
  })

  it('ação pendente trava o cartão e o aviso de ITEM_CHANGED aparece nele (CA-04.05)', async () => {
    const card = await mountSuspended(QueueItemCard, {
      props: {
        item: item(),
        stages,
        now,
        pending: 'Preparando: Na fila',
        notice:
          'Outro aparelho mexeu neste item antes: agora está em Preparando (3). Sua ação não foi aplicada.',
      },
    })
    expect(card.get('[data-testid="advance"]').attributes('disabled')).toBeDefined()
    expect(card.text()).toContain('Na fila')
    expect(card.text()).toContain('Sua ação não foi aplicada')
  })
})

describe('item na comanda (spec 04, seção 8.1)', () => {
  it('RN-04.21: "Entregue" só nos itens prontos', async () => {
    const ready = await mountSuspended(TabItemRow, {
      props: { item: item({ stageId: 's3', stageName: 'Pronto' }), stages, now, editable: true },
    })
    await ready.get('[data-testid="deliver"]').trigger('click')
    expect(ready.emitted('deliver')).toHaveLength(1)

    const cooking = await mountSuspended(TabItemRow, {
      props: {
        item: item({ stageId: 's2', stageName: 'Preparando' }),
        stages,
        now,
        editable: true,
      },
    })
    expect(cooking.find('[data-testid="deliver"]').exists()).toBe(false)
  })

  it('cancelar parte exige motivo e envia a quantidade (RN-04.25, RN-04.26)', async () => {
    const row = await mountSuspended(TabItemRow, {
      props: { item: item({ stageId: 's2' }), stages, now, editable: true },
    })
    await row
      .findAll('button')
      .find((b) => b.text() === 'Cancelar item')!
      .trigger('click')
    expect(row.text()).toContain('conta como perda')
    await row.get('[aria-label="Diminuir quantidade a cancelar"]').trigger('click')
    await row.get('form').trigger('submit')
    expect(row.text()).toContain('Diga o motivo do cancelamento.')
    expect(row.emitted('cancel')).toBeUndefined()
    await row.get('input').setValue('cliente desistiu')
    await row.get('form').trigger('submit')
    expect(row.emitted('cancel')).toEqual([[{ quantity: 2, reason: 'cliente desistiu' }]])
  })
})

describe('folha de opções do produto (RN-03.13, CA-03.06)', () => {
  it('não adiciona sem a escolha obrigatória; com ela, adiciona com acréscimos e total', async () => {
    const sheet = await mountSuspended(ProductOptions, {
      props: { product: skewer(), shiftPrices: [{ productId: 'p1', priceCents: 1000 }] },
    })
    await sheet.get('form').trigger('submit')
    expect(sheet.text()).toContain('Escolha uma opção em Ponto da carne.')
    expect(sheet.emitted('add')).toBeUndefined()

    const option = (name: string) => sheet.findAll('button').find((b) => b.text().includes(name))!
    await option('Ao ponto').trigger('click')
    await option('Pão de alho').trigger('click')
    await sheet.get('[aria-label="Aumentar quantidade"]').trigger('click')
    // Preço do turno (CA-04.07) + acréscimo: (10,00 + 3,00) × 2
    expect(sheet.get('[data-testid="add-to-order"]').text()).toContain('R$ 26,00')
    await sheet.get('form').trigger('submit')
    const [[line]] = sheet.emitted('add') as [[CartLine]]
    expect(line).toMatchObject({
      productId: 'p1',
      quantity: 2,
      unitPriceCents: 1000,
      modifiers: [{ name: 'Ao ponto' }, { name: 'Pão de alho', priceDeltaCents: 300 }],
    })
  })
})
