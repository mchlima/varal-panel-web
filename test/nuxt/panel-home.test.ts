import { mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UnitOperation } from '~/lib/operation'
import HomePage from '~/pages/painel/index.vue'
import type { PanelMe } from '~/stores/session'
import {
  COUNTER,
  REGISTER,
  UNIT,
  cashRegister,
  closedRegister,
  unitOperation,
} from '../support/operation-fixtures'

const ID = '0192f000-0000-7000-8000-0000000000d1'

function signIn(type: 'owner' | 'staff' = 'owner', canOperateCash = true) {
  const session = useSessionStore()
  session.me = {
    subject: { type, id: ID, name: 'Michel Lima', email: null, username: null },
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
        canOperateCash,
        allStations: true,
        lateAfterMinutes: 15,
        stationIds: [COUNTER],
        stations: [{ id: COUNTER, name: 'Balcão', kind: 'counter' }],
      },
    ],
    session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
    impersonation: null,
  } as unknown as PanelMe
  session.status = 'authenticated'
}

const mounted: Pick<VueWrapper, 'unmount'>[] = []
const mountSuspended: typeof mount = async (...args) => {
  const wrapper = await mount(...args)
  mounted.push(wrapper)
  return wrapper
}

function ok<T>(body: T) {
  return { data: body, error: undefined, response: new Response(JSON.stringify(body)) }
}

/** `GET` falso: a operação da unidade e respostas vazias para o resto. */
function mockApi(operation: () => UnitOperation) {
  return vi.spyOn(useNuxtApp().$api, 'GET').mockImplementation(((route: string) => {
    if (route === '/api/v1/units/{id}/operation') return Promise.resolve(ok(operation()))
    if (route === '/api/v1/units/{id}/menu') {
      return Promise.resolve(
        ok({
          unitId: UNIT,
          version: 1,
          categories: [{ id: 'c', products: [{ id: 'p' }] }],
          priceLists: [],
          currentPriceListId: null,
          effectivePriceListId: null,
          effectivePriceListName: 'Normal',
        }),
      )
    }
    if (route === '/api/v1/reports/summary') {
      return Promise.resolve(
        ok({ partial: true, summary: { salesCents: 18_000, receivedCents: 8_000 } }),
      )
    }
    return Promise.resolve(ok({ data: [], nextCursor: null }))
  }) as never)
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  useOperationStore().clear()
})

describe('início do painel orientado à tarefa (spec 01, seção 14.2)', () => {
  it('CA-01.18: sem caixa aberto, "Abrir caixa" é o único botão principal; ao abrir, vira "Abrir balcão" sem recarregar', async () => {
    signIn()
    mockApi(() => unitOperation({ cashRegisters: [closedRegister()] }))
    const page = await mountSuspended(HomePage)
    await flushPromises()
    const action = page.get('[data-testid="home-action"]')
    expect(action.attributes('data-state')).toBe('open-cash')
    const primary = page.findAll('.bg-primary')
    expect(primary).toHaveLength(1)
    expect(primary[0]!.text()).toContain('Abrir caixa')
    expect(primary[0]!.attributes('href')).toBe(`/caixas/${REGISTER}/abrir`)

    // `unit.operation_updated` com o caixa aberto (aplicado pelo store, como o evento faz).
    useOperationStore().apply(unitOperation({ cashRegisters: [cashRegister()], version: 2 }))
    await flushPromises()
    expect(page.get('[data-testid="home-action"]').attributes('data-state')).toBe('open-counter')
    const after = page.findAll('.bg-primary')
    expect(after).toHaveLength(1)
    expect(after[0]!.text()).toContain('Abrir balcão')
    expect(page.get('[data-testid="open-registers"]').text()).toContain('Caixa 1')
    expect(page.get('[data-testid="home-price-list"]').text()).toBe('Normal')
  })

  it('RN-05.26: caixa aberto desde ontem pede "Fechar caixa"', async () => {
    signIn()
    const open = cashRegister()
    mockApi(() =>
      unitOperation({
        cashRegisters: [{ ...open, session: { ...open.session!, openSinceEarlierDay: true } }],
      }),
    )
    const page = await mountSuspended(HomePage)
    await flushPromises()
    expect(page.get('[data-testid="earlier-register"]').text()).toContain('Caixa 1 aberto desde')
    expect(page.get('[data-testid="primary-action"]').text()).toContain('Fechar caixa')
    expect(page.get('[data-testid="primary-action"]').attributes('href')).toBe(
      `/caixas/${REGISTER}/fechar`,
    )
  })

  it('CA-01.19: comanda aberta há mais de 2 dias aparece com link e some depois de paga', async () => {
    signIn()
    let stale = true
    mockApi(() =>
      unitOperation({
        businessDate: '2026-10-05',
        staleTabs: stale
          ? [
              {
                id: 't7',
                number: 7,
                customerName: 'Seu Zé',
                businessDate: '2026-10-02',
                openedAt: '2026-10-02T21:00:00.000Z',
                totalCents: 4_500,
              },
            ]
          : [],
      }),
    )
    const page = await mountSuspended(HomePage)
    await flushPromises()
    const warning = page.get('[data-testid="stale-tabs"]')
    expect(warning.text()).toContain('Comandas abertas há mais de 2 dias')
    const link = page.get('[data-testid="stale-tab-7"]')
    expect(link.attributes('href')).toBe('/balcao/comandas/7')
    expect(link.text()).toContain('Seu Zé')
    expect(link.text()).toContain('desde 02/10')
    // O aviso é informativo: a ação principal continua sendo a da operação.
    expect(warning.find('.bg-primary').exists()).toBe(false)

    stale = false
    await useOperationStore().load(UNIT)
    await flushPromises()
    expect(page.find('[data-testid="stale-tabs"]').exists()).toBe(false)
  })

  it('dono vê a venda e o recebido parciais de hoje com link para o relatório do dia', async () => {
    signIn()
    mockApi(() => unitOperation())
    const page = await mountSuspended(HomePage)
    await flushPromises()
    const today = page.get('[data-testid="home-today"]')
    expect(today.text()).toMatch(/Venda hoje\s+R\$\s180,00/)
    expect(today.text()).toContain('valores parciais')
  })

  it('RN-01.23: quem opera caixa não vê relatórios nem cadastros', async () => {
    signIn('staff', true)
    mockApi(() => unitOperation())
    const page = await mountSuspended(HomePage)
    await flushPromises()
    const text = page.text()
    expect(text).toContain('Abrir balcão')
    expect(text).not.toContain('Relatórios')
    expect(text).not.toContain('Colaboradores')
    expect(page.find('[data-testid="home-today"]').exists()).toBe(false)
  })
})
