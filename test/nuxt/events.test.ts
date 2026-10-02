import { mockNuxtImport, mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { components } from '~/api/schema'
import EventForm from '~/components/EventForm.vue'
import type { ContractedEvent } from '~/lib/operation'
import EventPage from '~/pages/painel/eventos/[id].vue'
import EventsPage from '~/pages/painel/eventos/index.vue'
import { UNIT } from '../support/operation-fixtures'
import {
  failResponse,
  mockApi,
  mountedWrappers,
  okResponse,
  signInAs,
  unmountAll,
} from '../support/panel-session'

type Schemas = components['schemas']
const EVENT = '0192f000-0000-7000-8000-0000000000ee'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const mountSuspended: typeof mount = async (...args) => {
  const wrapper = await mount(...args)
  mountedWrappers.push(wrapper)
  return wrapper
}

function event(overrides: Partial<ContractedEvent> = {}): ContractedEvent {
  return {
    id: EVENT,
    unitId: UNIT,
    contractorName: 'Casamento Ana e Leo',
    startsOn: '2026-10-10',
    endsOn: null,
    modality: 'consumption_billed',
    agreedAmountCents: null,
    agreedQuantity: 500,
    limits: null,
    notes: null,
    priceList: { id: 'pl', name: 'Evento' },
    status: 'scheduled',
    startedAt: null,
    startedBy: null,
    finishedAt: null,
    finishedBy: null,
    canceledAt: null,
    version: 1,
    ...overrides,
  }
}

beforeEach(() => {
  navigateToMock.mockReset()
  useContractedEventsStore().clear()
})

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  useMenuStore().clear()
})

describe('lista de eventos (spec 04, seção 8.3)', () => {
  it('em andamento no topo; "Novo evento" só para o dono', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/units/{id}/events': () =>
        okResponse({
          data: [
            event({ id: 'a', contractorName: 'Festa agendada', startsOn: '2026-11-01' }),
            event({ id: 'b', contractorName: 'Casamento hoje', status: 'in_progress' }),
          ],
        }),
    })
    const wrapper = await mountSuspended(EventsPage)
    await flushPromises()
    const cards = wrapper.findAll('[data-testid="event-card"]')
    expect(cards[0]!.text()).toContain('Casamento hoje')
    expect(cards[0]!.text()).toContain('Em andamento')
    expect(cards[1]!.text()).toContain('Agendado')
    expect(wrapper.find('[data-testid="new-event"]').exists()).toBe(true)
  })

  it('quem opera caixa vê a lista, mas não cadastra; vazio explica', async () => {
    signInAs('staff', true)
    mockApi('GET', { '/api/v1/units/{id}/events': () => okResponse({ data: [] }) })
    const wrapper = await mountSuspended(EventsPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="new-event"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nenhum evento cadastrado.')
  })
})

describe('detalhe do evento (RN-04.34, RN-04.35, RN-04.37)', () => {
  it('quem opera caixa inicia, mas não edita nem cancela', async () => {
    signInAs('staff', true)
    mockApi('GET', { '/api/v1/events/{id}': () => okResponse(event()) })
    const post = mockApi('POST', {
      '/api/v1/events/{id}/start': () => okResponse(event({ status: 'in_progress', version: 2 })),
    })
    const wrapper = await mountSuspended(EventPage, { route: `/painel/eventos/${EVENT}` })
    await flushPromises()
    expect(wrapper.find('[data-testid="edit-event"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Cancelar evento')
    expect(wrapper.text()).not.toContain('Ver relatório do evento')
    await wrapper.find('[data-testid="start-event"]').trigger('click')
    await flushPromises()
    const [path, options] = post.mock.calls[0] as unknown as [
      string,
      { body: unknown; params: { header: Record<string, string> } },
    ]
    expect(path).toBe('/api/v1/events/{id}/start')
    expect(options.body).toEqual({ version: 1 })
    expect(options.params.header['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(wrapper.text()).toContain('Evento em andamento.')
    expect(wrapper.find('[data-testid="finish-event"]').exists()).toBe(true)
  })

  it('CA-04.15: segundo evento em andamento é explicado', async () => {
    signInAs('owner')
    mockApi('GET', { '/api/v1/events/{id}': () => okResponse(event()) })
    mockApi('POST', {
      '/api/v1/events/{id}/start': () =>
        failResponse(409, 'EVENT_ALREADY_IN_PROGRESS', 'Já há um evento em andamento.'),
    })
    const wrapper = await mountSuspended(EventPage, { route: `/painel/eventos/${EVENT}` })
    await flushPromises()
    await wrapper.find('[data-testid="start-event"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Já há um evento em andamento.')
    expect(wrapper.text()).toContain('Encerre aquele evento')
  })

  it('dono vê editar, cancelar e, em andamento, o relatório', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/events/{id}': () => okResponse(event({ status: 'in_progress' })),
    })
    const wrapper = await mountSuspended(EventPage, { route: `/painel/eventos/${EVENT}` })
    await flushPromises()
    expect(wrapper.find('[data-testid="edit-event"]').exists()).toBe(true)
    expect(wrapper.find(`a[href="/painel/relatorios/eventos/${EVENT}"]`).exists()).toBe(true)
    // Em andamento não se cancela (RN-04.34: só agendado → cancelado).
    expect(wrapper.text()).not.toContain('Cancelar evento')
  })
})

describe('cadastro do evento (RN-04.05)', () => {
  it('envia o acordo e a tabela; "Normal" vai como null', async () => {
    signInAs('owner')
    mockApi('GET', {
      '/api/v1/units/{id}/menu': () =>
        okResponse({
          unitId: UNIT,
          version: 1,
          currentPriceListId: null,
          effectivePriceListId: null,
          effectivePriceListName: 'Normal',
          categories: [],
          priceLists: [
            {
              id: 'pl',
              unitId: UNIT,
              name: 'Evento',
              sortOrder: 1,
              active: true,
              current: false,
              productCount: 3,
              version: 1,
            },
          ],
        }),
    })
    const post = mockApi('POST', {
      '/api/v1/units/{id}/events': () => okResponse(event(), 201),
    })
    const wrapper = await mountSuspended(EventForm, { props: { unitId: UNIT } })
    await flushPromises()
    const selects = wrapper.findAll('select')
    expect(selects[1]!.findAll('option').map((o) => o.text())).toEqual([
      'Normal (preço do cardápio)',
      'Evento',
    ])
    await wrapper.find('input').setValue('Festa da Empresa')
    await selects[0]!.setValue('per_quantity')
    await selects[1]!.setValue('pl')
    const quantity = wrapper.findAll('input').find((i) => i.attributes('inputmode') === 'numeric')!
    await quantity.setValue('300')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const [, options] = post.mock.calls[0] as unknown as [
      string,
      { body: Schemas['CreateContractedEventRequestInput'] },
    ]
    expect(options.body).toMatchObject({
      contractorName: 'Festa da Empresa',
      modality: 'per_quantity',
      agreedQuantity: 300,
      priceListId: 'pl',
    })
    expect(options.body.startsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(wrapper.emitted('saved')).toHaveLength(1)
  })
})
