import { mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PanelShell from '~/components/PanelShell.vue'
import type {
  CashSessionReport,
  DayHistory,
  EventReport,
  ReportCashSessionLine,
  SummaryReport,
} from '~/lib/report'
import HistoryPage from '~/pages/painel/relatorios/index.vue'
import SessionReportPage from '~/pages/painel/relatorios/caixas/[id].vue'
import EventReportPage from '~/pages/painel/relatorios/eventos/[id].vue'
import PeriodPage from '~/pages/painel/relatorios/periodo.vue'
import type { PanelMe } from '~/stores/session'

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'
const UNIT = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8f'
const SESSION = '01a0f6f8-4a82-77c9-b59d-f7b27d590e90'
const EVENT = '01a0f6f8-4a82-77c9-b59d-f7b27d590e91'
const REGISTER = '01a0f6f8-4a82-77c9-b59d-f7b27d590e92'

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
const period = { from: '2026-09-02', to: '2026-10-01', timeZone: 'America/Sao_Paulo' as const }
const owner = { id: ID, name: 'Dono do Piloto', type: 'owner' as const }

function dayRow(n: number, overrides: Partial<DayHistory['data'][number]> = {}) {
  return {
    unitId: UNIT,
    unitName: 'Barraca da Praça',
    businessDate: `2026-09-0${n}`,
    partial: false,
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

function sessionLine(overrides: Partial<ReportCashSessionLine> = {}): ReportCashSessionLine {
  return {
    sessionId: SESSION,
    cashRegisterId: REGISTER,
    name: 'Caixa 1',
    unitId: UNIT,
    unitName: 'Barraca da Praça',
    businessDate: '2026-10-01',
    status: 'closed',
    openedAt: '2026-10-01T20:00:00.000Z',
    closedAt: '2026-10-02T02:00:00.000Z',
    responsible: owner,
    receivedCents: 8_000,
    differenceCents: -500,
    pendingTabsCount: 2,
    pendingTabsTotalCents: 4_000,
    ...overrides,
  }
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  useSessionStore().clear()
  useContractedEventsStore().clear()
})

describe('histórico (spec 07, seção 7)', () => {
  it('pede os últimos 30 dias, mostra os totais e os dias, e junta a página seguinte', async () => {
    signIn()
    const get = mockGet({
      '/api/v1/reports/days': (init) =>
        ok({
          period,
          totals,
          ...(init?.params?.query?.cursor === 'p2'
            ? { data: [dayRow(1)], nextCursor: null }
            : { data: [dayRow(3, { partial: true }), dayRow(2)], nextCursor: 'p2' }),
        }),
    })
    const wrapper = await mountSuspended(HistoryPage)
    await flushPromises()

    const [first] = queriesOf(get, '/api/v1/reports/days') as Record<string, unknown>[]
    expect(first).toMatchObject({ limit: 50 })
    expect(first!.cursor).toBeUndefined()
    expect(first!.unitId).toBeUndefined()
    const from = new Date(`${first!.from as string}T12:00:00Z`)
    const to = new Date(`${first!.to as string}T12:00:00Z`)
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(29)

    // CA-07.04: a diferença de caixa aparece no histórico.
    const totalsText = wrapper.find('[data-testid="period-totals"]').text()
    expect(totalsText).toMatch(/Venda\s*R\$\s180,00/)
    expect(totalsText).toMatch(/Recebido\s*R\$\s130,00/)
    expect(totalsText).toMatch(/Pendurado\s*R\$\s100,00/)
    expect(totalsText).toMatch(/Falta R\$\s5,00/)
    expect(wrapper.find('[data-testid="period-30d"]').attributes('aria-pressed')).toBe('true')

    const rows = wrapper.findAll('[data-testid="history-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.attributes('href')).toBe(
      `/painel/relatorios/periodo?unidade=${UNIT}&de=2026-09-03&ate=2026-09-03`,
    )
    expect(rows[0]!.text()).toContain('Em andamento')
    expect(wrapper.find('[data-testid="open-period-report"]').attributes('href')).toContain(
      `de=${first!.from as string}`,
    )
    // Sem eventos na organização, a aba Eventos não aparece.
    expect(wrapper.find('[data-testid="tab-eventos"]').exists()).toBe(false)

    const more = wrapper.findAll('button').find((b) => b.text().includes('Carregar mais'))
    await more!.trigger('click')
    await flushPromises()
    const second = queriesOf(get, '/api/v1/reports/days')[1] as Record<string, unknown>
    expect(second).toMatchObject({ cursor: 'p2', from: first!.from, to: first!.to })
    expect(wrapper.findAll('[data-testid="history-row"]')).toHaveLength(3)
  })

  it('aba Caixas lista as aberturas com a diferença (CA-07.04) e abre o relatório do caixa', async () => {
    signIn()
    const get = mockGet({
      '/api/v1/reports/days': () => ok({ period, totals, data: [], nextCursor: null }),
      '/api/v1/reports/cash-sessions': () =>
        ok({ period, totals, data: [sessionLine()], nextCursor: null }),
    })
    const wrapper = await mountSuspended(HistoryPage, { route: '/painel/relatorios?aba=caixas' })
    await flushPromises()
    expect(queriesOf(get, '/api/v1/reports/cash-sessions')).toHaveLength(1)
    const row = wrapper.find('[data-testid="history-row"]')
    expect(row.attributes('href')).toBe(`/painel/relatorios/caixas/${SESSION}`)
    expect(row.text()).toContain('Caixa 1')
    expect(row.text()).toMatch(/Falta R\$\s5,00/)
    expect(row.text()).toContain('2 comandas pendentes')
  })

  it('a aba Eventos aparece quando a organização tem eventos', async () => {
    signIn()
    mockGet({
      '/api/v1/units/{id}/events': () => ok({ data: [{ id: EVENT, unitId: UNIT, version: 1 }] }),
      '/api/v1/reports/days': () => ok({ period, totals, data: [], nextCursor: null }),
    })
    const wrapper = await mountSuspended(HistoryPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="tab-eventos"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="history-empty"]').text()).toContain('Nenhum dia')
  })

  it('mostra que relatórios são só do dono quando a API responde 403 (RN-07.07, CA-07.06)', async () => {
    signIn()
    mockGet({
      '/api/v1/reports/days': () => fail(403, 'FORBIDDEN', 'Só o dono pode usar esta rota.'),
    })
    const wrapper = await mountSuspended(HistoryPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="reports-forbidden"]').text()).toContain(
      'Relatórios são só do dono',
    )
    expect(wrapper.find('[data-testid="history-row"]').exists()).toBe(false)
  })
})

const summaryValues = {
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
}

const credit = {
  onCreditCents: 10_000,
  settlementsCents: 0,
  tabs: [
    {
      tabId: ID,
      number: 2,
      customerName: 'Seu Zé',
      customer: { id: 'c1', name: 'Seu Zé', reference: 'apto 42', removed: false },
      status: 'on_credit' as const,
      amountCents: 10_000,
      balanceCents: 10_000,
      creditAt: '2026-10-01T23:00:00.000Z',
    },
  ],
  settlements: [],
}

const products = [
  {
    productId: ID,
    productName: 'Espeto de carne',
    quantity: 12,
    valueCents: 18_000,
    priceLists: [
      { priceListId: null, priceListName: 'Normal', quantity: 10, valueCents: 12_000 },
      { priceListId: 'pl', priceListName: 'Evento', quantity: 2, valueCents: 6_000 },
    ],
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
]

function summaryReport(overrides: Partial<SummaryReport> = {}): SummaryReport {
  return {
    period: { from: '2026-10-01', to: '2026-10-01', timeZone: 'America/Sao_Paulo' },
    unit: { id: UNIT, name: 'Barraca da Praça' },
    partial: false,
    summary: summaryValues,
    openTabsNow: null,
    products,
    paymentMethods: [
      { method: 'cash', salesCents: 8_000, settlementsCents: 0, totalCents: 8_000 },
      { method: 'pix', salesCents: 0, settlementsCents: 0, totalCents: 0 },
      { method: 'credit_card', salesCents: 0, settlementsCents: 0, totalCents: 0 },
      { method: 'debit_card', salesCents: 0, settlementsCents: 0, totalCents: 0 },
    ],
    staff: [
      {
        actor: owner,
        tabsOpened: 3,
        ordersSent: 4,
        receivedCents: 8_000,
        itemsCanceled: 0,
        tabsCanceled: 1,
        discountCount: 0,
        discountsCents: 0,
      },
    ],
    cashSessions: [sessionLine()],
    credit,
    cancellations: { items: [], tabs: [], wasteCents: 0, wasteQuantity: 0 },
    events: [],
    ...overrides,
  }
}

describe('relatório do dia ou período (spec 07, seção 4)', () => {
  it('mostra venda, recebido, pendurado e as seções (CA-07.01, CA-07.04)', async () => {
    signIn()
    const get = mockGet({ '/api/v1/reports/summary': () => ok(summaryReport()) })
    const wrapper = await mountSuspended(PeriodPage, {
      route: `/painel/relatorios/periodo?unidade=${UNIT}&de=2026-10-01&ate=2026-10-01`,
    })
    await flushPromises()

    expect(queriesOf(get, '/api/v1/reports/summary')[0]).toEqual({
      unitId: UNIT,
      from: '2026-10-01',
      to: '2026-10-01',
    })
    expect(wrapper.find('h1').text()).toBe('Dia qui, 01/10/2026')
    expect(wrapper.find('[data-testid="report-partial"]').exists()).toBe(false)

    const summary = wrapper.find('[data-testid="report-summary"]').text()
    expect(summary).toMatch(/Venda\s*R\$\s180,00/)
    expect(summary).toMatch(/Recebido\s*R\$\s80,00/)
    expect(summary).toMatch(/Pendurado\s*R\$\s100,00/)
    expect(summary).toMatch(/Falta R\$\s5,00/)

    const productsText = wrapper.find('[data-testid="report-products"]').text()
    expect(productsText).toContain('+ Farofa')
    expect(productsText).toContain('Preços: Evento')
    expect(wrapper.find('[data-testid="report-payments"]').text()).toContain('Dinheiro')
    expect(wrapper.find('[data-testid="report-staff"]').text()).toContain('Dono do Piloto')
    expect(wrapper.find('[data-testid="report-credit"]').text()).toContain('Seu Zé (apto 42)')
    expect(wrapper.find('[data-testid="report-register-row"]').attributes('href')).toBe(
      `/painel/relatorios/caixas/${SESSION}`,
    )
    // A seção de eventos só aparece quando houve evento.
    expect(wrapper.find('[data-testid="report-events"]').exists()).toBe(false)
  })

  it('avisa os valores parciais, mostra as comandas em aberto e os eventos (RN-07.06)', async () => {
    signIn()
    mockGet({
      '/api/v1/reports/summary': () =>
        ok(
          summaryReport({
            partial: true,
            openTabsNow: { count: 3, totalCents: 4_500 },
            events: [
              {
                eventId: EVENT,
                contractorName: 'Casamento Ana e Leo',
                salesCents: 6_000,
                status: 'in_progress',
              },
            ],
          }),
        ),
    })
    const wrapper = await mountSuspended(PeriodPage, {
      route: '/painel/relatorios/periodo?de=2026-09-25&ate=2026-10-01',
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="report-partial"]').text()).toContain(
      'Em andamento — valores parciais',
    )
    expect(wrapper.find('h1').text()).toBe('25/09/2026 a 01/10/2026')
    expect(wrapper.find('[data-testid="report-summary"]').text()).toMatch(
      /Em aberto agora\s*R\$\s45,00\s*3 comandas/,
    )
    const events = wrapper.find('[data-testid="report-events"]')
    expect(events.text()).toContain('Casamento Ana e Leo')
    expect(events.find('a').attributes('href')).toBe(`/painel/relatorios/eventos/${EVENT}`)
  })
})

function sessionReport(overrides: Partial<CashSessionReport> = {}): CashSessionReport {
  return {
    timeZone: 'America/Sao_Paulo',
    partial: false,
    unitName: 'Barraca da Praça',
    responsible: { id: ID, name: 'Ana', type: 'staff' },
    closedByActor: { id: ID, name: 'Ana', type: 'staff' },
    session: {
      id: SESSION,
      cashRegisterId: REGISTER,
      name: 'Caixa 1',
      unitId: UNIT,
      businessDate: '2026-10-01',
      status: 'closed',
      openingFloatCents: 10_000,
      openedBy: { type: 'staff', id: ID },
      openedByName: 'Ana',
      openedAt: '2026-10-01T20:00:00.000Z',
      openSinceEarlierDay: false,
      closedBy: { type: 'staff', id: ID },
      closedAt: '2026-10-02T02:00:00.000Z',
      closingNote: 'Faltou troco',
      expected: [],
      cash: {
        openingFloatCents: 10_000,
        paymentsCents: 8_000,
        creditSettlementsCents: 0,
        depositsCents: 0,
        withdrawalsCents: 0,
      },
      counts: [],
      creditSettlementsCents: 0,
      receivedCents: 8_000,
      differenceCents: -500,
      pendingTabsCount: 2,
      pendingTabsTotalCents: 4_000,
      version: 3,
    },
    byMethod: [
      {
        method: 'cash',
        expectedCents: 18_000,
        informedCents: 17_500,
        differenceCents: -500,
        salesCents: 8_000,
        settlementsCents: 0,
      },
      {
        method: 'pix',
        expectedCents: 0,
        informedCents: 0,
        differenceCents: 0,
        salesCents: 0,
        settlementsCents: 0,
      },
    ],
    movements: [
      {
        id: 'm1',
        type: 'withdrawal',
        amountCents: 2_000,
        reason: 'Depósito no banco',
        createdAt: '2026-10-01T22:00:00.000Z',
        createdBy: owner,
      },
    ],
    payments: [
      {
        paymentId: 'pay1',
        tabId: ID,
        tabNumber: 7,
        customerName: 'Dona Marta',
        method: 'cash',
        amountCents: 8_000,
        changeCents: 2_000,
        isCreditSettlement: false,
        receivedAt: '2026-10-01T21:00:00.000Z',
        receivedBy: owner,
        reversedAt: '2026-10-01T21:05:00.000Z',
        reversalReason: 'Errou a forma',
      },
    ],
    pending: { count: 2, totalCents: 4_000 },
    totals: { ...totals, salesCents: 0, receivedCents: 8_000, cashDifferenceCents: -500 },
    ...overrides,
  }
}

describe('relatório do caixa (spec 07, seção 5)', () => {
  it('mostra conferência por forma, movimentos, pagamentos estornados e pendentes (CA-07.04)', async () => {
    signIn()
    mockGet({ '/api/v1/cash-register-sessions/{id}/report': () => ok(sessionReport()) })
    const wrapper = await mountSuspended(SessionReportPage, {
      route: `/painel/relatorios/caixas/${SESSION}`,
    })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Caixa 1')
    const summary = wrapper.find('[data-testid="report-summary"]').text()
    expect(summary).toContain('Ana')
    expect(summary).toMatch(/Falta R\$\s5,00/)
    expect(summary).not.toContain('Venda')
    const methods = wrapper.find('[data-testid="report-methods"]').text()
    expect(methods).toMatch(/informado R\$\s175,00/)
    expect(methods).toContain('Faltou troco')
    expect(wrapper.find('[data-testid="report-movements"]').text()).toContain('Depósito no banco')
    const payments = wrapper.find('[data-testid="report-payments"]').text()
    expect(payments).toContain('Estornado')
    expect(payments).toMatch(/troco R\$\s20,00/)
    expect(wrapper.find('[data-testid="report-pending"]').text()).toContain(
      '2 comandas seguiram abertas',
    )
  })

  it('caixa aberto: valores parciais e sem diferença (RN-07.06, RN-07.08)', async () => {
    signIn()
    const report = sessionReport({ partial: true, pending: null })
    report.session = { ...report.session, status: 'open', closedAt: null, differenceCents: 0 }
    mockGet({ '/api/v1/cash-register-sessions/{id}/report': () => ok(report) })
    const wrapper = await mountSuspended(SessionReportPage, {
      route: `/painel/relatorios/caixas/${SESSION}`,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="report-partial"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="report-summary"]').text()).toContain('Aberto')
    expect(wrapper.find('[data-testid="report-summary"]').text()).toContain('aparece no fechamento')
    expect(wrapper.find('[data-testid="report-pending"]').exists()).toBe(false)
  })
})

function eventReport(overrides: Partial<EventReport> = {}): EventReport {
  return {
    timeZone: 'America/Sao_Paulo',
    partial: false,
    unitName: 'Barraca da Praça',
    event: {
      id: EVENT,
      unitId: UNIT,
      contractorName: 'Festa da Firma',
      startsOn: '2026-10-01',
      endsOn: '2026-10-02',
      modality: 'per_quantity',
      agreedAmountCents: null,
      agreedQuantity: 500,
      limits: '500 espetos',
      notes: null,
      priceList: { id: 'pl', name: 'Evento' },
      status: 'finished',
      startedAt: '2026-10-01T20:00:00.000Z',
      startedBy: { type: 'owner', id: ID },
      finishedAt: '2026-10-03T02:00:00.000Z',
      finishedBy: { type: 'owner', id: ID },
      canceledAt: null,
      version: 3,
    },
    summary: summaryValues,
    agreement: { consumedQuantity: 462, consumedCents: 18_000, quantityDifference: 38 },
    products,
    tabs: [
      {
        tabId: ID,
        number: 4,
        customerName: 'Festa da Firma',
        businessDate: '2026-10-02',
        status: 'on_credit',
        totalCents: 10_000,
        paidCents: 0,
        balanceCents: 10_000,
      },
    ],
    credit,
    cancellations: { items: [], tabs: [], wasteCents: 0, wasteQuantity: 0 },
    ...overrides,
  }
}

describe('relatório do evento (spec 07, seção 6)', () => {
  it('compara o combinado com o consumido somando os dias do evento (CA-07.03)', async () => {
    signIn()
    mockGet({ '/api/v1/events/{id}/report': () => ok(eventReport()) })
    const wrapper = await mountSuspended(EventReportPage, {
      route: `/painel/relatorios/eventos/${EVENT}`,
    })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Festa da Firma')
    expect(wrapper.text()).toContain('01/10/2026 a 02/10/2026')
    expect(wrapper.find('[data-testid="report-summary"]').text()).toContain('Preços: Evento')
    expect(wrapper.find('[data-testid="agreement-difference"]').text()).toContain('Diferença: 38')
    expect(wrapper.find('[data-testid="report-agreement"]').text()).toContain('500 espetos')
    expect(wrapper.find('[data-testid="report-tabs"]').text()).toMatch(/a receber R\$\s100,00/)
  })

  it('mostra a mensagem de acesso quando a API responde 403 (CA-07.06)', async () => {
    signIn()
    mockGet({
      '/api/v1/events/{id}/report': () => fail(403, 'FORBIDDEN', 'Só o dono pode usar esta rota.'),
    })
    const wrapper = await mountSuspended(EventReportPage, {
      route: `/painel/relatorios/eventos/${EVENT}`,
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="report-forbidden"]').exists()).toBe(true)
  })
})

describe('menu do painel (RN-07.07)', () => {
  it('mostra Relatórios ao dono e esconde de quem não é dono', async () => {
    signIn('owner')
    mockGet({})
    const ownerShell = await mountSuspended(PanelShell)
    expect(ownerShell.findAll('a').some((a) => a.attributes('href') === '/painel/relatorios')).toBe(
      true,
    )

    signIn('staff')
    const staff = await mountSuspended(PanelShell)
    expect(staff.findAll('a').some((a) => a.attributes('href') === '/painel/relatorios')).toBe(
      false,
    )
  })
})
