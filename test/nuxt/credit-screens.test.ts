import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CustomerForm from '~/components/CustomerForm.vue'
import ReceivableTabCard from '~/components/ReceivableTabCard.vue'
import type { Customer } from '~/lib/customer'
import { tabSummary } from '../support/operation-fixtures'

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    unitId: 'u',
    name: 'Seu Zé',
    phone: null,
    cpf: null,
    reference: null,
    note: null,
    removedAt: null,
    createdAt: '2026-10-01T19:00:00.000Z',
    version: 0,
    ...overrides,
  }
}

describe('cadastro rápido de cliente (RN-06.01, RN-06.02)', () => {
  it('cadastra só com o nome quando não há homônimo (CA-06.06)', async () => {
    const findSameName = vi.fn().mockResolvedValue([])
    const wrapper = await mountSuspended(CustomerForm, { props: { findSameName } })
    await wrapper.find('input').setValue('Maria Nova')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(findSameName).toHaveBeenCalledWith('Maria Nova')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({ name: 'Maria Nova', phone: '' })
  })

  it('avisa do homônimo sem identificação e sugere a referência; confirma na segunda vez', async () => {
    const findSameName = vi
      .fn()
      .mockResolvedValue([
        customer({ reference: 'apto 42' }),
        customer({ id: 'c2', name: 'Seu Zé da Silva' }),
      ])
    const wrapper = await mountSuspended(CustomerForm, { props: { findSameName } })
    await wrapper.find('input').setValue('Seu Zé')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const warning = wrapper.find('[data-testid="homonym-warning"]')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('Preencha a referência')
    expect(warning.text()).toContain('apto 42')
    expect(warning.text()).not.toContain('Seu Zé da Silva')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('mostra telefone e CPF inválidos na linha do campo', async () => {
    const wrapper = await mountSuspended(CustomerForm)
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('Ana')
    await inputs[1]!.setValue('1234')
    await inputs[2]!.setValue('111.111.111-11')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('Telefone com DDD')
    expect(wrapper.text()).toContain('CPF inválido')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('telefone repetido na unidade aparece no campo de telefone (CA-06.06)', async () => {
    const wrapper = await mountSuspended(CustomerForm, {
      props: {
        error: {
          code: 'CUSTOMER_PHONE_TAKEN',
          message: 'Telefone já cadastrado.',
          hint: 'Já existe um cliente com este telefone nesta unidade: busque por ele.',
          details: {},
        },
      },
    })
    expect(wrapper.text()).toContain('Já existe um cliente com este telefone')
  })
})

describe('comanda no fiado (spec 06, seção 8)', () => {
  it('mostra cliente, data e saldo e abre o receber pela id', async () => {
    const wrapper = await mountSuspended(ReceivableTabCard, {
      props: {
        tab: tabSummary({
          id: 'tab-9',
          number: 9,
          status: 'on_credit',
          totalCents: 12_000,
          paidCents: 2_000,
          balanceCents: 10_000,
          creditAt: '2026-10-01T22:00:00.000Z',
          customer: { id: 'c1', name: 'Dona Cida', reference: 'apto 42', removed: false },
        }),
      },
    })
    expect(wrapper.text()).toContain('Dona Cida (apto 42)')
    expect(wrapper.text()).toContain('01/10')
    expect(wrapper.find('[data-testid="credit-tab-balance"]').text()).toMatch(/100,00/)
    expect(wrapper.find('a').attributes('href')).toBe('/balcao/comandas/9/receber?comanda=tab-9')
  })
})
