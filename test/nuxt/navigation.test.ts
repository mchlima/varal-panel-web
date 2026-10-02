import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NewTabForm from '~/components/NewTabForm.vue'
import NoCashNotice from '~/components/NoCashNotice.vue'
import OperationShell from '~/components/OperationShell.vue'
import OperationStrip from '~/components/OperationStrip.vue'
import PriceListSwitcher from '~/components/PriceListSwitcher.vue'
import TabCard from '~/components/TabCard.vue'
import type { ContractedEvent } from '~/lib/operation'
import StationsPage from '~/pages/estacoes.vue'
import type { PanelMe } from '~/stores/session'
import {
  COUNTER,
  DELIVERY,
  KITCHEN,
  REGISTER,
  UNIT,
  closedRegister,
  tabSummary,
  unitOperation,
} from '../support/operation-fixtures'

const ID = '0192f000-0000-7000-8000-0000000000d1'

function signIn(
  type: 'owner' | 'staff',
  options: {
    canOperateCash?: boolean
    stations?: { id: string; name: string; kind: string }[]
  } = {},
) {
  const session = useSessionStore()
  session.me = {
    subject: { type, id: ID, name: 'Bruno', email: null, username: 'bruno' },
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
        canOperateCash: options.canOperateCash ?? type === 'owner',
        allStations: type === 'owner',
        lateAfterMinutes: 15,
        stationIds: [],
        stations: options.stations ?? [
          { id: COUNTER, name: 'Balcão', kind: 'counter' },
          { id: KITCHEN, name: 'Cozinha', kind: 'queue' },
          { id: DELIVERY, name: 'Balcão de entrega', kind: 'queue' },
        ],
      },
    ],
    session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
    impersonation: null,
  } as unknown as PanelMe
  session.status = 'authenticated'
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('voltar ao painel a partir da operação (spec 01, RN-01.25 a RN-01.27)', () => {
  it('CA-01.16 / CA-08.05: o dono vê "Painel" (texto e ícone, 48 px) e "Trocar de estação"', async () => {
    signIn('owner')
    const shell = await mountSuspended(OperationShell, { props: { title: 'Cozinha' } })
    const panel = shell.get('[data-testid="go-panel"]')
    expect(panel.text()).toBe('Painel')
    expect(panel.find('svg').exists()).toBe(true)
    expect(panel.attributes('href')).toBe('/painel')
    expect(panel.classes()).toEqual(expect.arrayContaining(['min-h-12', 'min-w-12']))
    const switcher = shell.get('[data-testid="switch-station"]')
    expect(switcher.text()).toContain('Cozinha')
    expect(switcher.text()).toContain('Trocar de estação')
    expect(switcher.classes()).toContain('min-h-12')
  })

  it('CA-01.17: colaborador só com a Cozinha não vê "Painel" nem "Trocar de estação"', async () => {
    signIn('staff', { stations: [{ id: KITCHEN, name: 'Cozinha', kind: 'queue' }] })
    const shell = await mountSuspended(OperationShell, { props: { title: 'Cozinha' } })
    expect(shell.find('[data-testid="go-panel"]').exists()).toBe(false)
    expect(shell.find('[data-testid="switch-station"]').exists()).toBe(false)
    expect(shell.text()).toContain('Sair')
  })

  it('nas telas internas do balcão, a seta de voltar leva ao varal', async () => {
    signIn('owner')
    const shell = await mountSuspended(OperationShell, {
      props: { title: '12 · Dona Marta', back: '/balcao', backLabel: 'Voltar ao varal' },
    })
    expect(shell.get('a[aria-label="Voltar ao varal"]').attributes('href')).toBe('/balcao')
    expect(shell.find('[data-testid="go-panel"]').exists()).toBe(false)
  })

  it('/estacoes tem "Painel" para quem tem painel (RN-01.25)', async () => {
    signIn('owner')
    const page = await mountSuspended(StationsPage)
    expect(page.get('[data-testid="go-panel"]').attributes('href')).toBe('/painel')
    signIn('staff', {
      stations: [
        { id: KITCHEN, name: 'Cozinha', kind: 'queue' },
        { id: DELIVERY, name: 'Balcão de entrega', kind: 'queue' },
      ],
    })
    const staffPage = await mountSuspended(StationsPage)
    expect(staffPage.find('[data-testid="go-panel"]').exists()).toBe(false)
  })
})

describe('faixa de operação do balcão (spec 04, seção 8.1; RN-04.33)', () => {
  it('mostra o caixa aberto e a tabela "Normal" em texto neutro; quem opera caixa pode trocar', async () => {
    signIn('owner')
    const strip = await mountSuspended(OperationStrip, {
      props: { unitId: UNIT, operation: unitOperation() },
    })
    expect(strip.get('[data-testid="strip-cash"]').text()).toBe('Caixa 1 aberto')
    const price = strip.get('[data-testid="strip-price-list"]')
    expect(price.text()).toContain('Preços: Normal')
    expect(price.element.tagName).toBe('BUTTON')
    expect(price.classes()).not.toContain('bg-primary-soft')
  })

  it('tabela diferente de "Normal" e evento em destaque; colaborador sem caixa não troca', async () => {
    signIn('staff', { canOperateCash: false })
    const event = { id: 'e1', contractorName: 'Casamento Ana e Leo' } as ContractedEvent
    const strip = await mountSuspended(OperationStrip, {
      props: {
        unitId: UNIT,
        operation: unitOperation({
          effectivePriceList: { id: 'pl', name: 'Evento' },
          eventInProgress: event,
        }),
      },
    })
    const price = strip.get('[data-testid="strip-price-list"]')
    expect(price.text()).toBe('Preços: Evento')
    expect(price.element.tagName).toBe('SPAN')
    expect(price.classes()).toContain('bg-primary-soft')
    expect(strip.get('[data-testid="strip-event"]').text()).toBe('Evento: Casamento Ana e Leo')
  })

  it('sem caixa aberto avisa na faixa', async () => {
    signIn('owner')
    const strip = await mountSuspended(OperationStrip, {
      props: { unitId: UNIT, operation: unitOperation({ cashRegisters: [closedRegister()] }) },
    })
    expect(strip.get('[data-testid="strip-cash"]').text()).toBe('Sem caixa aberto')
  })
})

describe('troca da tabela vigente (spec 04, seção 8.4; RN-04.31, RN-04.32)', () => {
  function mockMenu() {
    vi.spyOn(useNuxtApp().$api, 'GET').mockImplementation((() =>
      Promise.resolve({
        data: {
          unitId: UNIT,
          version: 1,
          categories: [],
          currentPriceListId: null,
          effectivePriceListId: null,
          effectivePriceListName: 'Normal',
          priceLists: [
            {
              id: 'pl-event',
              unitId: UNIT,
              name: 'Evento',
              sortOrder: 1,
              active: true,
              current: false,
              productCount: 3,
              version: 1,
            },
          ],
        },
        error: undefined,
        response: new Response('{}'),
      })) as never)
  }

  it('lista "Normal" e as tabelas ativas com a contagem e confirma "Itens novos usarão os preços de Evento"', async () => {
    signIn('owner')
    mockMenu()
    const put = vi.spyOn(useNuxtApp().$api, 'PUT').mockResolvedValue({
      data: unitOperation({ currentPriceList: { id: 'pl-event', name: 'Evento' }, version: 2 }),
      error: undefined,
      response: new Response('{}'),
    } as never)
    const switcher = await mountSuspended(PriceListSwitcher, {
      props: { unitId: UNIT, operation: unitOperation(), open: false },
    })
    await switcher.setProps({ open: true })
    await flushPromises()
    const body = document.body
    const option = body.querySelector<HTMLButtonElement>(
      '[data-testid="price-list-option-Evento"]',
    )!
    expect(option.textContent).toContain('3 produtos com preço nesta tabela')
    expect(body.querySelector('[data-testid="price-list-option-Normal"]')!.textContent).toContain(
      'Vigente',
    )
    option.click()
    await flushPromises()
    expect(body.textContent).toContain('Itens novos usarão os preços de Evento')
    body.querySelector<HTMLButtonElement>('[data-testid="confirm-price-list"]')!.click()
    await flushPromises()
    expect(put).toHaveBeenCalledWith('/api/v1/units/{id}/current-price-list', {
      params: { path: { id: UNIT } },
      body: { priceListId: 'pl-event', version: 1 },
    })
    expect(useOperationStore().get(UNIT)?.currentPriceList?.name).toBe('Evento')
    switcher.unmount()
  })

  it('RN-04.32: durante um evento, explica que a tabela é a do evento e não oferece troca', async () => {
    signIn('owner')
    mockMenu()
    const event = {
      id: 'e1',
      contractorName: 'Casamento Ana e Leo',
      priceList: { id: 'pl-event', name: 'Evento' },
    } as ContractedEvent
    const switcher = await mountSuspended(PriceListSwitcher, {
      props: { unitId: UNIT, operation: unitOperation({ eventInProgress: event }), open: false },
    })
    await switcher.setProps({ open: true })
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Durante o evento, os preços são os do evento.')
    expect(text).toContain('Casamento Ana e Leo')
    expect(document.body.querySelector('[data-testid="price-list-option-Normal"]')).toBeNull()
    switcher.unmount()
  })
})

describe('sem caixa aberto (RN-04.02, CA-05.08)', () => {
  it('quem opera caixa vê "Abrir caixa" direto na abertura do único caixa', async () => {
    signIn('staff', { canOperateCash: true })
    useOperationStore().apply(unitOperation({ cashRegisters: [closedRegister()] }))
    const notice = await mountSuspended(NoCashNotice, { props: { unitId: UNIT } })
    expect(notice.text()).toContain('Abra um caixa para vender')
    expect(notice.get('a').attributes('href')).toBe(`/caixas/${REGISTER}/abrir?volta=balcao`)
  })

  it('os outros veem o pedido para quem cuida do caixa', async () => {
    signIn('staff', { canOperateCash: false })
    const notice = await mountSuspended(NoCashNotice, { props: { unitId: UNIT } })
    expect(notice.text()).toContain('Peça para quem cuida do caixa abri-lo')
    expect(notice.find('a').exists()).toBe(false)
  })
})

describe('comandas que passam de dia e evento (RN-04.10, RN-04.36)', () => {
  it('CA-04.09: comanda de ontem continua no varal com o número e a data', async () => {
    const card = await mountSuspended(TabCard, {
      props: {
        tab: tabSummary({ number: 7, businessDate: '2026-10-01' }),
        businessDate: '2026-10-02',
      },
    })
    expect(card.text()).toContain('7')
    expect(card.get('[data-testid="tab-card-since"]').text()).toBe('desde 01/10')
    const today = await mountSuspended(TabCard, {
      props: { tab: tabSummary({ businessDate: '2026-10-02' }), businessDate: '2026-10-02' },
    })
    expect(today.find('[data-testid="tab-card-since"]').exists()).toBe(false)
  })

  it('com evento em andamento, a nova comanda avisa que é do evento', async () => {
    const form = await mountSuspended(NewTabForm, { props: { eventName: 'Casamento Ana e Leo' } })
    expect(form.get('[data-testid="new-tab-event"]').text()).toBe(
      'Esta comanda é do evento Casamento Ana e Leo',
    )
  })
})
