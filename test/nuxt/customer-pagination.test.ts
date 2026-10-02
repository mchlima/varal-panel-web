import { mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CustomerPicker from '~/components/CustomerPicker.vue'
import type { Customer } from '~/lib/customer'
import FiadoPage from '~/pages/painel/fiado/index.vue'
import type { PanelMe } from '~/stores/session'

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'
const UNIT = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8f'

function signIn(type: 'owner' | 'staff' = 'owner') {
  const session = useSessionStore()
  session.me = {
    subject: { type, id: ID, name: 'Dono', email: 'd@v.l', username: null },
    organization: {
      id: ID,
      name: 'Espetinho do Piloto',
      accessCode: 'ESPT26',
      subscriptionStatus: 'active',
      suspendedReason: null,
    },
    units: [
      {
        id: UNIT,
        name: 'Barraca da Praça',
        canOperateCash: true,
        stations: [{ id: ID, name: 'Balcão', kind: 'counter' }],
      },
    ],
    session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
    impersonation: null,
  } as unknown as PanelMe
  session.status = 'authenticated'
}

/** Telas montadas no teste, desmontadas no fim para não ouvirem o `GET` falso do próximo. */
const mounted: Pick<VueWrapper, 'unmount'>[] = []
const mountSuspended: typeof mount = async (...args) => {
  const wrapper = await mount(...args)
  mounted.push(wrapper)
  return wrapper
}

function ok<T>(body: T) {
  return { data: body, error: undefined, response: new Response(JSON.stringify(body)) }
}

type Handler = (init: { params?: { query?: Record<string, unknown> } } | undefined) => unknown

/** `GET` falso por rota; as outras rotas do painel (comunicados etc.) respondem vazio. */
function mockGet(routes: Record<string, Handler>) {
  return vi.spyOn(useNuxtApp().$api, 'GET').mockImplementation(((
    route: string,
    init?: { params?: { query?: Record<string, unknown> } },
  ) => {
    const handler = routes[route]
    return Promise.resolve(handler ? handler(init) : ok({ data: [], nextCursor: null }))
  }) as never)
}

function queriesOf(spy: ReturnType<typeof mockGet>, path: string) {
  const all = spy.mock.calls as unknown as [string, { params?: { query?: unknown } }][]
  return all.filter(([route]) => route === path).map(([, init]) => init?.params?.query)
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  useSessionStore().clear()
})

function customer(n: number): Customer {
  return {
    id: `c${n}`,
    unitId: UNIT,
    name: `Cliente ${n}`,
    phone: null,
    cpf: null,
    reference: null,
    note: null,
    removedAt: null,
    createdAt: '2026-10-01T19:00:00.000Z',
    version: 0,
  }
}

const customersPage: Handler = (init) =>
  ok(
    init?.params?.query?.cursor === 'p2'
      ? { data: [customer(3)], nextCursor: null }
      : { data: [customer(1), customer(2)], nextCursor: 'p2' },
  )

describe('busca de clientes paginada (spec 06, seção 7)', () => {
  it('fiado: lista em ordem de nome com "Carregar mais" pelo cursor', async () => {
    signIn()
    const get = mockGet({
      '/api/v1/units/{id}/customers': customersPage,
      '/api/v1/units/{id}/receivables': () =>
        ok({ unitId: UNIT, totalCents: 0, customers: [], tabs: [] }),
    })
    const wrapper = await mountSuspended(FiadoPage)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="customer-row"]')).toHaveLength(2)

    const more = wrapper.findAll('button').find((b) => b.text().includes('Carregar mais'))
    await more!.trigger('click')
    await flushPromises()
    const queries = queriesOf(get, '/api/v1/units/{id}/customers')
    expect(queries[queries.length - 1]).toMatchObject({ cursor: 'p2', limit: 50 })
    expect(wrapper.findAll('[data-testid="customer-row"]')).toHaveLength(3)
    expect(wrapper.findAll('button').some((b) => b.text().includes('Carregar mais'))).toBe(false)
  })

  it('pendurar: a busca continua com o cursor e o mesmo texto', async () => {
    signIn()
    const get = mockGet({ '/api/v1/units/{id}/customers': customersPage })
    const wrapper = await mountSuspended(CustomerPicker, { props: { unitId: UNIT } })
    await wrapper.find('[data-testid="customer-search"]').setValue('Cli')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await flushPromises()
    expect(wrapper.findAll('[data-testid="customer-result"]')).toHaveLength(2)
    expect(queriesOf(get, '/api/v1/units/{id}/customers')[0]).toEqual({ q: 'Cli', limit: 20 })

    const more = wrapper.findAll('button').find((b) => b.text().includes('Carregar mais'))
    await more!.trigger('click')
    await flushPromises()
    expect(queriesOf(get, '/api/v1/units/{id}/customers')[1]).toEqual({
      q: 'Cli',
      limit: 20,
      cursor: 'p2',
    })
    expect(wrapper.findAll('[data-testid="customer-result"]')).toHaveLength(3)
  })
})
