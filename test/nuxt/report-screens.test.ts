import { mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PanelShell from '~/components/PanelShell.vue'
import type { ShiftHistory, ShiftReport } from '~/lib/report'
import HistoryPage from '~/pages/painel/relatorios/index.vue'
import ReportPage from '~/pages/painel/relatorios/turnos/[id].vue'
import type { PanelMe } from '~/stores/session'

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'
const UNIT = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8f'
const SHIFT = '01a0f6f8-4a82-77c9-b59d-f7b27d590e90'

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

function fail(status: number, code: string, message: string) {
  const body = { error: { code, message, details: {} } }
  return { data: undefined, error: body, response: new Response(JSON.stringify(body), { status }) }
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

const totals = {
  shiftCount: 2,
  tabCount: 3,
  salesCents: 18_000,
  receivedCents: 13_000,
  receivedSalesCents: 8_000,
  receivedSettlementsCents: 5_000,
  onCreditCents: 10_000,
  wasteCents: 1_200,
  wasteQuantity: 2,
  discountsCents: 500,
  cashDifferenceCents: -500,
}

function row(n: number, overrides: Partial<ShiftHistory['data'][number]> = {}) {
  return {
    shiftId: `shift-${n}`,
    unitId: UNIT,
    unitName: 'Barraca da Praça',
    type: 'direct_sale' as const,
    status: 'closed' as const,
    date: `2026-09-0${n}`,
    openedAt: `2026-09-0${n}T21:00:00.000Z`,
    closedAt: `2026-09-0${n}T23:59:00.000Z`,
    tabCount: 1,
    salesCents: 6_000,
    receivedCents: 6_000,
    receivedSalesCents: 6_000,
    receivedSettlementsCents: 0,
    onCreditCents: 0,
    wasteCents: 0,
    wasteQuantity: 0,
    discountsCents: 0,
    cashDifferenceCents: 0,
    ...overrides,
  }
}

function history(data: ShiftHistory['data'], nextCursor: string | null): ShiftHistory {
  return {
    data,
    nextCursor,
    totals,
    period: { from: '2026-09-02', to: '2026-10-01', timeZone: 'America/Sao_Paulo' },
  }
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  useSessionStore().clear()
})

describe('histórico de turnos (spec 07, seção 5)', () => {
  it('pede os últimos 30 dias, mostra os totais do período e junta a página seguinte', async () => {
    signIn()
    const get = mockGet({
      '/api/v1/reports/shifts': (init) =>
        ok(
          init?.params?.query?.cursor === 'p2'
            ? history([row(1)], null)
            : history([row(3, { status: 'open', cashDifferenceCents: -500 }), row(2)], 'p2'),
        ),
    })
    const wrapper = await mountSuspended(HistoryPage)
    await flushPromises()

    const [first] = queriesOf(get, '/api/v1/reports/shifts') as Record<string, unknown>[]
    expect(first).toMatchObject({ limit: 50 })
    expect(first!.cursor).toBeUndefined()
    expect(first!.unitId).toBeUndefined()
    const from = new Date(`${first!.from as string}T12:00:00Z`)
    const to = new Date(`${first!.to as string}T12:00:00Z`)
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(29)

    const totalsText = wrapper.find('[data-testid="period-totals"]').text()
    expect(totalsText).toMatch(/Venda\s*R\$\s180,00/)
    expect(totalsText).toMatch(/Recebido\s*R\$\s130,00/)
    expect(totalsText).toMatch(/Pendurado\s*R\$\s100,00/)
    expect(totalsText).toContain('Falta R$ 5,00')
    expect(wrapper.find('[aria-pressed="true"]').text()).toBe('30 dias')

    const rows = wrapper.findAll('[data-testid="history-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.attributes('href')).toBe('/painel/relatorios/turnos/shift-3')
    expect(rows[0]!.text()).toContain('Em andamento')

    const more = wrapper.findAll('button').find((b) => b.text().includes('Carregar mais'))
    await more!.trigger('click')
    await flushPromises()
    const second = queriesOf(get, '/api/v1/reports/shifts')[1] as Record<string, unknown>
    expect(second).toMatchObject({ cursor: 'p2', from: first!.from, to: first!.to })
    expect(wrapper.findAll('[data-testid="history-row"]')).toHaveLength(3)
  })

  it('mostra que relatórios são só do dono quando a API responde 403 (RN-07.07, CA-07.06)', async () => {
    signIn()
    mockGet({
      '/api/v1/reports/shifts': () => fail(403, 'FORBIDDEN', 'Só o dono pode usar esta rota.'),
    })
    const wrapper = await mountSuspended(HistoryPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="reports-forbidden"]').text()).toContain(
      'Relatórios são só do dono',
    )
    expect(wrapper.find('[data-testid="history-row"]').exists()).toBe(false)
  })
})

function report(overrides: Partial<ShiftReport> = {}): ShiftReport {
  const actor = { id: ID, name: 'Dono do Piloto', type: 'owner' as const }
  return {
    timeZone: 'America/Sao_Paulo',
    partial: false,
    shift: {
      id: SHIFT,
      unitId: UNIT,
      unitName: 'Barraca da Praça',
      type: 'contracted',
      status: 'closed',
      date: '2026-10-01',
      openedAt: '2026-10-01T20:00:00.000Z',
      openedBy: actor,
      closedAt: '2026-10-02T02:00:00.000Z',
      closedBy: actor,
    },
    summary: {
      salesCents: 18_000,
      tabCount: 2,
      averageTicketCents: 9_000,
      discountsCents: 0,
      receivedCents: 8_000,
      receivedSalesCents: 8_000,
      receivedSettlementsCents: 0,
      onCreditCents: 10_000,
      wasteCents: 0,
      wasteQuantity: 0,
      cashDifferenceCents: -500,
      canceledTabCount: 1,
    },
    products: [
      {
        productId: ID,
        productName: 'Espeto de carne',
        quantity: 12,
        valueCents: 18_000,
        modifiers: [
          {
            groupName: 'Acompanhamento',
            modifierName: 'Farofa',
            priceDeltaCents: 100,
            quantity: 3,
            valueCents: 300,
          },
        ],
      },
    ],
    paymentMethods: [
      { method: 'cash', salesCents: 8_000, settlementsCents: 0, totalCents: 8_000 },
      { method: 'pix', salesCents: 0, settlementsCents: 0, totalCents: 0 },
      { method: 'credit_card', salesCents: 0, settlementsCents: 0, totalCents: 0 },
      { method: 'debit_card', salesCents: 0, settlementsCents: 0, totalCents: 0 },
    ],
    staff: [
      {
        actor,
        tabsOpened: 3,
        ordersSent: 4,
        receivedCents: 8_000,
        itemsCanceled: 0,
        tabsCanceled: 1,
        discountCount: 0,
        discountsCents: 0,
      },
    ],
    cashRegisters: [],
    credit: {
      onCreditCents: 10_000,
      settlementsCents: 0,
      tabs: [
        {
          tabId: ID,
          number: 2,
          customerName: 'Seu Zé',
          customer: { id: 'c1', name: 'Seu Zé', reference: 'apto 42', removed: false },
          status: 'on_credit',
          amountCents: 10_000,
          balanceCents: 10_000,
          creditAt: '2026-10-01T23:00:00.000Z',
        },
      ],
      settlements: [],
    },
    cancellations: { items: [], tabs: [], wasteCents: 0, wasteQuantity: 0 },
    agreement: {
      contractorName: 'Festa da Firma',
      modality: 'per_quantity',
      agreedAmountCents: null,
      agreedQuantity: 500,
      consumedQuantity: 462,
      consumedCents: 18_000,
      quantityDifference: 38,
      limits: null,
      notes: null,
    },
    ...overrides,
  }
}

describe('relatório do turno (spec 07, seção 4)', () => {
  it('mostra resumo, acordo com a diferença e as seções (CA-07.01, CA-07.03, CA-07.04)', async () => {
    signIn()
    const get = mockGet({ '/api/v1/shifts/{id}/report': () => ok(report()) })
    const wrapper = await mountSuspended(ReportPage, {
      route: `/painel/relatorios/turnos/${SHIFT}`,
    })
    await flushPromises()

    const calls = (get.mock.calls as unknown as [string, unknown][]).filter(
      ([route]) => route === '/api/v1/shifts/{id}/report',
    )
    expect(calls[0]![1]).toEqual({ params: { path: { id: SHIFT } } })
    expect(wrapper.find('h1').text()).toBe('Turno de qui, 01/10/2026')
    expect(wrapper.find('[data-testid="report-partial"]').exists()).toBe(false)

    const summary = wrapper.find('[data-testid="report-summary"]').text()
    expect(summary).toMatch(/Venda\s*R\$\s180,00/)
    expect(summary).toMatch(/Recebido\s*R\$\s80,00/)
    expect(summary).toMatch(/Pendurado\s*R\$\s100,00/)
    expect(summary).toContain('Falta R$ 5,00')
    // Horário de Brasília: 20:00 UTC são 17:00.
    expect(summary).toContain('01/10/2026, 17:00')

    const agreement = wrapper.find('[data-testid="report-agreement"]').text()
    expect(agreement).toContain('Festa da Firma')
    expect(wrapper.find('[data-testid="agreement-difference"]').text()).toContain('Diferença: 38')

    expect(wrapper.find('[data-testid="report-products"]').text()).toContain('+ Farofa')
    expect(wrapper.find('[data-testid="report-payments"]').text()).toContain('Dinheiro')
    expect(wrapper.find('[data-testid="report-staff"]').text()).toContain('Dono do Piloto')
    expect(wrapper.find('[data-testid="report-credit"]').text()).toContain('Seu Zé (apto 42)')
    expect(wrapper.find('[data-testid="report-cancellations"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="report-registers"]').exists()).toBe(true)
  })

  it('avisa que os valores são parciais com o turno aberto (RN-07.06)', async () => {
    signIn()
    mockGet({
      '/api/v1/shifts/{id}/report': () => ok(report({ partial: true, agreement: null })),
    })
    const wrapper = await mountSuspended(ReportPage, {
      route: `/painel/relatorios/turnos/${SHIFT}`,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="report-partial"]').text()).toContain(
      'Turno em andamento — valores parciais',
    )
    expect(wrapper.find('[data-testid="report-agreement"]').exists()).toBe(false)
  })

  it('mostra a mensagem de acesso quando a API responde 403 (CA-07.06)', async () => {
    signIn()
    mockGet({
      '/api/v1/shifts/{id}/report': () => fail(403, 'FORBIDDEN', 'Só o dono pode usar esta rota.'),
    })
    const wrapper = await mountSuspended(ReportPage, {
      route: `/painel/relatorios/turnos/${SHIFT}`,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="report-forbidden"]').exists()).toBe(true)
  })
})

describe('menu do painel (RN-07.07)', () => {
  it('mostra Relatórios ao dono e esconde de quem não é dono', async () => {
    signIn('owner')
    mockGet({})
    const owner = await mountSuspended(PanelShell)
    expect(owner.findAll('a').some((a) => a.attributes('href') === '/painel/relatorios')).toBe(true)

    signIn('staff')
    const staff = await mountSuspended(PanelShell)
    expect(staff.findAll('a').some((a) => a.attributes('href') === '/painel/relatorios')).toBe(
      false,
    )
  })
})
