import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProductOptions from '~/components/ProductOptions.vue'
import TabItemRow from '~/components/TabItemRow.vue'
import type { CartLine } from '~/lib/order-builder'
import { item, skewer, stages } from '../support/operation-fixtures'

const now = Date.parse('2026-10-01T20:05:00.000Z')

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
      props: { product: skewer({ effectivePriceCents: 1000 }) },
    })
    await sheet.get('form').trigger('submit')
    expect(sheet.text()).toContain('Escolha uma opção em Ponto da carne.')
    expect(sheet.emitted('add')).toBeUndefined()

    const option = (name: string) => sheet.findAll('button').find((b) => b.text().includes(name))!
    await option('Ao ponto').trigger('click')
    await option('Pão de alho').trigger('click')
    await sheet.get('[aria-label="Aumentar quantidade"]').trigger('click')
    // Preço da tabela efetiva (CA-04.07) + acréscimo: (10,00 + 3,00) × 2
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
