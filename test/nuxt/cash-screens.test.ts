import { mockNuxtImport, mountSuspended as mount } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CashRegister, CashRegisterClosePreview } from '~/lib/payment'
import CashPage from '~/pages/caixas/index.vue'
import OpenPage from '~/pages/caixas/[id]/abrir.vue'
import ClosePage from '~/pages/caixas/[id]/fechar.vue'
import RegistersSetupPage from '~/pages/painel/unidades/[id]/caixas.vue'
import type { PanelMe } from '~/stores/session'
import {
  REGISTER,
  SESSION,
  UNIT,
  cashRegister,
  closedRegister,
  unitOperation,
} from '../support/operation-fixtures'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'
const SECOND = '0192f000-0000-7000-8000-0000000000e9'

function signIn(type: 'owner' | 'staff' = 'owner') {
  const session = useSessionStore()
  session.me = {
    subject: { type, id: ID, name: type === 'owner' ? 'Dono' : 'Ana', email: null, username: null },
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
        allStations: type === 'owner',
        lateAfterMinutes: 15,
        stationIds: [],
        stations: [{ id: ID, name: 'Balcão', kind: 'counter' }],
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

function fail(status: number, code: string, message: string, details = {}) {
  const body = { error: { code, message, details } }
  return { data: undefined, error: body, response: new Response(JSON.stringify(body), { status }) }
}

type Handler = (init: unknown) => unknown

function mockApi(method: 'GET' | 'POST' | 'PATCH' | 'PUT', routes: Record<string, Handler>) {
  return vi.spyOn(useNuxtApp().$api, method).mockImplementation(((route: string, init: unknown) => {
    const handler = routes[route]
    return Promise.resolve(handler ? handler(init) : ok({ data: [], nextCursor: null }))
  }) as never)
}

function mockRegisters(registers: CashRegister[]) {
  return mockApi('GET', {
    '/api/v1/units/{id}/cash-registers': () => ok({ data: registers }),
    '/api/v1/units/{id}/operation': () => ok(unitOperation({ cashRegisters: registers })),
  })
}

/** Texto com espaços normais (o `Intl` usa espaço fixo em "R$ 1,00"). */
function text(wrapper: { text: () => string }): string {
  return wrapper.text().replace(/\u00a0/g, ' ')
}

/** Botões preenchidos com a primária (spec 08, CA-08.02). */
function primaryButtons(wrapper: VueWrapper) {
  return wrapper.findAll('.bg-primary.text-primary-ink')
}

function preview(overrides: Partial<CashRegisterClosePreview> = {}): CashRegisterClosePreview {
  return {
    session: cashRegister().session!,
    pendingTabs: [
      {
        id: 't1',
        number: 7,
        customerName: 'Dona Marta',
        status: 'open',
        totalCents: 4_800,
        businessDate: '2026-09-30',
        openedAt: '2026-09-30T20:00:00.000Z',
      },
      {
        id: 't2',
        number: 8,
        customerName: 'Seu João',
        status: 'closing',
        totalCents: 2_200,
        businessDate: '2026-10-01',
        openedAt: '2026-10-01T20:00:00.000Z',
      },
    ],
    pendingTabsTotalCents: 7_000,
    lastOpenRegister: true,
    itemsInProgress: 3,
    eventInProgress: { id: 'e1', contractorName: 'Casamento Ana e Leo' },
    ...overrides,
  }
}

beforeEach(() => {
  navigateToMock.mockReset()
  useOperationStore().clear()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('tela de caixas (spec 05, seção 8)', () => {
  it('um único caixa fechado: vai direto ao "Abrir caixa", única ação principal (CA-08.02)', async () => {
    signIn()
    mockRegisters([closedRegister()])
    const page = await mountSuspended(CashPage, { route: '/caixas' })
    await flushPromises()
    const open = page.get('[data-testid="open-register"]')
    expect(open.text()).toContain('Abrir Caixa 1')
    expect(open.attributes('href')).toBe(`/caixas/${REGISTER}/abrir`)
    expect(page.find('[data-testid="close-register-link"]').exists()).toBe(false)
    expect(primaryButtons(page)).toHaveLength(1)
  })

  it('CA-05.10 (lado do app): "Abrir" só no caixa fechado; o aberto mostra esperado e fechar', async () => {
    signIn()
    mockRegisters([cashRegister(), closedRegister({ id: SECOND, name: 'Caixa 2', sortOrder: 2 })])
    const page = await mountSuspended(CashPage, { route: '/caixas?volta=balcao' })
    await flushPromises()
    const cards = page.findAll('[data-testid="register-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.attributes('data-state')).toBe('open')
    expect(cards[0]!.find('[data-testid="open-register"]').exists()).toBe(false)
    expect(text(cards[0]!.get('[data-testid="expected-cash"]'))).toBe('R$ 100,00')
    expect(cards[0]!.text()).toContain('Dono do Piloto')
    // `?volta=balcao` segue para a abertura (volta ao balcão depois de abrir).
    expect(cards[1]!.get('[data-testid="open-register"]').attributes('href')).toBe(
      `/caixas/${SECOND}/abrir?volta=balcao`,
    )
    // Com vários caixas, nenhum botão preenchido (nada esquecido aberto).
    expect(primaryButtons(page)).toHaveLength(0)
  })

  it('RN-05.26: caixa aberto desde ontem mostra o aviso e "Fechar caixa" em destaque', async () => {
    signIn('staff')
    const register = cashRegister()
    register.session = {
      ...register.session!,
      openSinceEarlierDay: true,
      openedAt: new Date(Date.now() - 86_400_000).toISOString(),
    }
    mockRegisters([register])
    const page = await mountSuspended(CashPage, { route: '/caixas' })
    await flushPromises()
    expect(page.get('[data-testid="open-since-earlier"]').text()).toContain('aberto desde ontem')
    const close = page.get('[data-testid="close-register-link"]')
    expect(close.classes()).toContain('bg-primary')
    expect(primaryButtons(page)).toHaveLength(1)
    // Cadastro de caixas é do dono (RN-05.27).
    expect(page.find('[data-testid="manage-registers"]').exists()).toBe(false)
  })
})

describe('abrir caixa (RN-05.23, RN-04.31, RN-04.35)', () => {
  it('CA-05.12: reabre com troco sugerido, avisa a tabela vigente e oferece o evento de hoje', async () => {
    signIn()
    const register = closedRegister()
    mockApi('GET', {
      '/api/v1/units/{id}/operation': () =>
        ok(
          unitOperation({
            cashRegisters: [register],
            currentPriceList: { id: 'pl', name: 'Evento' },
            effectivePriceList: { id: 'pl', name: 'Evento' },
            eventsToday: [
              {
                id: 'e1',
                unitId: UNIT,
                contractorName: 'Casamento Ana e Leo',
                startsOn: '2026-10-01',
                endsOn: null,
                modality: 'fixed_fee',
                agreedAmountCents: null,
                agreedQuantity: null,
                limits: null,
                notes: null,
                priceList: null,
                status: 'scheduled',
                startedAt: null,
                startedBy: null,
                finishedAt: null,
                finishedBy: null,
                canceledAt: null,
                version: 0,
              },
            ],
          }),
        ),
    })
    const post = mockApi('POST', {
      '/api/v1/cash-registers/{id}/open': () => ok(cashRegister({ version: 2 })),
    })
    const page = await mountSuspended(OpenPage, { route: `/caixas/${REGISTER}/abrir` })
    await flushPromises()
    expect((page.get('input[inputmode="decimal"]').element as HTMLInputElement).value).toBe(
      '100,00',
    )
    expect(page.get('[data-testid="price-list-warning"]').text()).toContain('Evento')
    expect(page.get('[data-testid="event-today"]').text()).toContain('Casamento Ana e Leo')
    await page.get('[data-testid="event-today"] input').setValue(true)
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalled()
    const [, init] = post.mock.calls[0] as unknown as [string, { body: unknown }]
    expect(init.body).toEqual({ openingFloatCents: 10_000, startEventId: 'e1' })
    expect(navigateToMock).toHaveBeenCalledWith('/painel')
    expect(primaryButtons(page).length).toBeLessThanOrEqual(1)
  })

  it('vindo do balcão, volta ao balcão; caixa já aberto em outro aparelho é explicado', async () => {
    signIn('staff')
    mockApi('GET', {
      '/api/v1/units/{id}/operation': () =>
        ok(unitOperation({ cashRegisters: [closedRegister()] })),
    })
    mockApi('POST', {
      '/api/v1/cash-registers/{id}/open': () =>
        fail(409, 'CASH_REGISTER_ALREADY_OPEN', 'Este caixa já está aberto.'),
    })
    const page = await mountSuspended(OpenPage, {
      route: `/caixas/${REGISTER}/abrir?volta=balcao`,
    })
    await flushPromises()
    await page.get('form').trigger('submit')
    await flushPromises()
    expect(page.text()).toContain('Este caixa já está aberto.')
    expect(page.text()).toContain('talvez em outro aparelho')
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})

describe('fechar caixa (RN-05.20, RN-05.28, RN-05.29)', () => {
  async function fill(page: VueWrapper, values: string[]) {
    const inputs = page.findAll('input[inputmode="decimal"]')
    for (const [index, value] of values.entries()) await inputs[index]!.setValue(value)
  }

  function mockClose(overrides: Partial<CashRegisterClosePreview> = {}) {
    mockApi('GET', {
      '/api/v1/units/{id}/operation': () => ok(unitOperation()),
      '/api/v1/cash-register-sessions/{id}/close-preview': () => ok(preview(overrides)),
    })
  }

  it('CA-05.07: com diferença, a observação é obrigatória e nada é enviado', async () => {
    signIn()
    mockClose()
    const post = mockApi('POST', {})
    const page = await mountSuspended(ClosePage, { route: `/caixas/${REGISTER}/fechar` })
    await flushPromises()
    await fill(page, ['95,00', '0', '0', '0'])
    expect(text(page.get('[data-testid="difference-cash"]'))).toContain('Falta R$ 5,00')
    await page.get('form').trigger('submit')
    expect(page.text()).toContain('Há diferença: explique na observação.')
    expect(page.find('[data-testid="confirm-close"]').exists()).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('CA-05.11 e RN-05.29: pendentes listados, opções do último caixa e fechamento aceito', async () => {
    signIn()
    mockClose()
    const closed = closedRegister()
    closed.session = {
      ...closed.session!,
      counts: [
        {
          method: 'cash',
          expectedCents: 10_000,
          informedCents: 10_000,
          differenceCents: 0,
          creditSettlementsCents: 0,
        },
        {
          method: 'pix',
          expectedCents: 0,
          informedCents: 0,
          differenceCents: 0,
          creditSettlementsCents: 0,
        },
        {
          method: 'credit_card',
          expectedCents: 0,
          informedCents: 0,
          differenceCents: 0,
          creditSettlementsCents: 0,
        },
        {
          method: 'debit_card',
          expectedCents: 0,
          informedCents: 0,
          differenceCents: 0,
          creditSettlementsCents: 0,
        },
      ],
      pendingTabsCount: 2,
      pendingTabsTotalCents: 7_000,
    }
    const post = mockApi('POST', {
      '/api/v1/cash-register-sessions/{id}/close': () => ok(closed),
    })
    const page = await mountSuspended(ClosePage, { route: `/caixas/${REGISTER}/fechar` })
    await flushPromises()
    const pending = page.findAll('[data-testid="pending-tab"]')
    expect(pending).toHaveLength(2)
    expect(pending[0]!.text()).toContain('Dona Marta')
    expect(pending[0]!.text()).toContain('desde 30/09')
    expect(page.get('[data-testid="pending-tabs"]').text()).toContain('continuam abertas')
    const finishItems = page.get('[data-testid="finish-pending-items"]').element as HTMLInputElement
    const finishEvent = page.get('[data-testid="finish-event"]').element as HTMLInputElement
    expect(finishItems.checked).toBe(true)
    expect(finishEvent.checked).toBe(false)
    expect(page.get('[data-testid="last-register-options"]').text()).toContain(
      'Casamento Ana e Leo',
    )

    await fill(page, ['100,00', '0', '0', '0'])
    await page.get('form').trigger('submit')
    await page.get('[data-testid="confirm-close-register"]').trigger('click')
    await flushPromises()
    const [route, init] = post.mock.calls[0] as unknown as [
      string,
      { params: { path: { id: string } }; body: Record<string, unknown> },
    ]
    expect(route).toBe('/api/v1/cash-register-sessions/{id}/close')
    expect(init.params.path.id).toBe(SESSION)
    expect(init.body).toMatchObject({ finishPendingItems: true, finishEvent: false })
    expect(init.body.counts).toHaveLength(4)

    // Resumo do próprio fechamento e, para o dono, o relatório do caixa (RN-07.07).
    const summary = page.get('[data-testid="closing-summary"]')
    expect(summary.text()).toContain('Confere')
    expect(text(summary)).toContain('R$ 70,00')
    expect(page.get('[data-testid="session-report"]').attributes('href')).toBe(
      `/painel/relatorios/caixas/${SESSION}`,
    )
  })

  it('RN-07.07: quem opera caixa vê o resumo, mas não o link do relatório', async () => {
    signIn('staff')
    mockClose({
      lastOpenRegister: false,
      itemsInProgress: 0,
      eventInProgress: null,
      pendingTabs: [],
      pendingTabsTotalCents: 0,
    })
    mockApi('POST', {
      '/api/v1/cash-register-sessions/{id}/close': () => ok(closedRegister()),
    })
    const page = await mountSuspended(ClosePage, { route: `/caixas/${REGISTER}/fechar` })
    await flushPromises()
    expect(page.find('[data-testid="last-register-options"]').exists()).toBe(false)
    expect(page.text()).toContain('Nenhuma comanda em aberto.')
    await fill(page, ['100,00', '0', '0', '0'])
    await page.get('form').trigger('submit')
    await page.get('[data-testid="confirm-close-register"]').trigger('click')
    await flushPromises()
    expect(page.find('[data-testid="register-closed"]').exists()).toBe(true)
    expect(page.find('[data-testid="session-report"]').exists()).toBe(false)
  })
})

describe('cadastro de caixas (RN-05.17, RN-05.27)', () => {
  it('CA-05.14: explica por que não dá para desativar o último caixa ativo', async () => {
    signIn()
    mockApi('GET', {
      '/api/v1/units/{id}/cash-registers': () => ok({ data: [closedRegister()] }),
    })
    const patch = mockApi('PATCH', {
      '/api/v1/cash-registers/{id}': () =>
        fail(409, 'LAST_ACTIVE_CASH_REGISTER', 'A unidade precisa de um caixa ativo.'),
    })
    const page = await mountSuspended(RegistersSetupPage, {
      route: `/painel/unidades/${UNIT}/caixas`,
    })
    await flushPromises()
    expect(page.get('[data-testid="register-row"]').text()).toContain('Fechado')
    await page
      .findAll('button')
      .find((button) => button.text() === 'Desativar')!
      .trigger('click')
    await page
      .findAll('button')
      .find((button) => button.text() === 'Desativar caixa')!
      .trigger('click')
    await flushPromises()
    expect(patch).toHaveBeenCalled()
    expect(page.text()).toContain('Cadastre ou ative outro caixa')
  })

  it('nome repetido é explicado', async () => {
    signIn()
    mockApi('GET', {
      '/api/v1/units/{id}/cash-registers': () => ok({ data: [cashRegister()] }),
    })
    mockApi('POST', {
      '/api/v1/units/{id}/cash-registers': () =>
        fail(409, 'CASH_REGISTER_NAME_TAKEN', 'Já existe um caixa com esse nome.'),
    })
    const page = await mountSuspended(RegistersSetupPage, {
      route: `/painel/unidades/${UNIT}/caixas`,
    })
    await flushPromises()
    await page.get('[data-testid="new-register-form"] input').setValue('Caixa 1')
    await page.get('[data-testid="new-register-form"]').trigger('submit')
    await flushPromises()
    expect(page.text()).toContain('Use outro nome')
  })
})
