import { mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/api/schema'
import PriceListPage from '~/pages/painel/cardapio/tabelas/[id].vue'
import PriceListsPage from '~/pages/painel/cardapio/tabelas/index.vue'
import { UNIT, skewer } from '../support/operation-fixtures'
import {
  failResponse,
  mockApi,
  mountedWrappers,
  okResponse,
  signInAs,
  unmountAll,
} from '../support/panel-session'

type Schemas = components['schemas']
const LIST = '0192f000-0000-7000-8000-0000000000e9'

const mountSuspended: typeof mount = async (...args) => {
  const wrapper = await mount(...args)
  mountedWrappers.push(wrapper)
  return wrapper
}

function priceList(overrides: Partial<Schemas['PriceList']> = {}): Schemas['PriceList'] {
  return {
    id: LIST,
    unitId: UNIT,
    name: 'Evento',
    sortOrder: 1,
    active: true,
    current: false,
    productCount: 1,
    version: 2,
    ...overrides,
  }
}

function menu(): Schemas['Menu'] {
  return {
    unitId: UNIT,
    version: 3,
    currentPriceListId: null,
    effectivePriceListId: null,
    effectivePriceListName: 'Normal',
    priceLists: [priceList()],
    categories: [
      {
        id: 'c1',
        unitId: UNIT,
        name: 'Espetos',
        sortOrder: 1,
        defaultStationId: 'k',
        active: true,
        products: [
          skewer({ modifierGroups: [] }),
          skewer({ id: 'p2', name: 'Espeto de frango', priceCents: 1000, sortOrder: 2 }),
          skewer({ id: 'p3', name: 'Kafta antiga', active: false, sortOrder: 3 }),
        ],
      },
    ],
  }
}

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  useMenuStore().clear()
})

describe('lista de tabelas de preço (spec 03, seção 5.3)', () => {
  it('mostra quantos produtos têm preço e qual vale agora', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/units/{id}/price-lists': () =>
        okResponse({
          data: [
            priceList({ current: true, productCount: 2 }),
            priceList({ id: 'off', name: 'Antiga', active: false, productCount: 0 }),
          ],
        }),
    })
    const wrapper = await mountSuspended(PriceListsPage)
    await flushPromises()
    const cards = wrapper.findAll('[data-testid="price-list"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('Evento')
    expect(cards[0]!.text()).toContain('2 produtos com preço')
    expect(cards[0]!.text()).toContain('Valendo agora')
    expect(cards[1]!.text()).toContain('Desativada')
    expect(cards[1]!.text()).toContain('Reativar')
  })

  it('CA-03.10: "Normal" e nome repetido são barrados antes de enviar', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/units/{id}/price-lists': () => okResponse({ data: [priceList()] }),
    })
    const post = mockApi('POST', {})
    const wrapper = await mountSuspended(PriceListsPage)
    await flushPromises()
    await wrapper.find('[data-testid="new-price-list"]').trigger('click')
    const input = wrapper.find('form input')
    await input.setValue('normal')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('"Normal" é o preço de sempre')
    await input.setValue('evento')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Já existe uma tabela com esse nome.')
    expect(post).not.toHaveBeenCalled()
  })

  it('RN-03.23: desativar a tabela em uso mostra o motivo e o que fazer', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/units/{id}/price-lists': () => okResponse({ data: [priceList({ current: true })] }),
    })
    const patch = mockApi('PATCH', {
      '/api/v1/price-lists/{id}': () =>
        failResponse(409, 'PRICE_LIST_IN_USE', 'Esta tabela está em uso.'),
    })
    const wrapper = await mountSuspended(PriceListsPage)
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Desativar')!
      .trigger('click')
    await flushPromises()
    const [, options] = patch.mock.calls[0] as unknown as [string, { body: unknown }]
    expect(options.body).toEqual({ active: false, version: 2 })
    expect(wrapper.text()).toContain('Esta tabela está em uso.')
    expect(wrapper.text()).toContain('Troque a tabela vigente')
  })
})

describe('preços de uma tabela (RN-03.22, CA-03.09)', () => {
  it('lista os produtos ativos com o preço normal ao lado e salva só o que mudou', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/price-lists/{id}': () =>
        okResponse({ priceList: priceList(), prices: [{ productId: 'p1', priceCents: 1500 }] }),
      '/api/v1/units/{id}/menu': () => okResponse(menu()),
    })
    const put = mockApi('PUT', {
      '/api/v1/price-lists/{id}/prices': () =>
        okResponse({
          priceList: priceList({ productCount: 1 }),
          prices: [{ productId: 'p2', priceCents: 1300 }],
        }),
    })
    const wrapper = await mountSuspended(PriceListPage, {
      route: `/painel/cardapio/tabelas/${LIST}`,
    })
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="price-row"]')
    expect(rows.map((row) => row.text().split('Normal')[0]!.trim())).toEqual([
      'Espeto de carne',
      'Espeto de frango',
    ])
    expect(rows[0]!.text()).toContain('Normal: R$ 12,00')
    const inputs = wrapper.findAll('[data-testid="price-row"] input')
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('15,00')
    await inputs[0]!.setValue('')
    await inputs[1]!.setValue('13')
    expect(wrapper.find('[data-testid="save-prices"]').text()).toBe('Salvar 2 alterações')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const [path, options] = put.mock.calls[0] as unknown as [
      string,
      { body: Schemas['PutPriceListPricesRequestInput'] },
    ]
    expect(path).toBe('/api/v1/price-lists/{id}/prices')
    expect(options.body.prices).toEqual([
      { productId: 'p1', priceCents: null },
      { productId: 'p2', priceCents: 1300 },
    ])
    expect(wrapper.text()).toContain('Preços salvos.')
  })
})
