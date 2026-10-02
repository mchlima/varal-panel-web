import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StationOrderCard from '~/components/StationOrderCard.vue'
import { toLine, type StationCard } from '~/lib/station'
import type { StationQueue } from '~/lib/operation'
import EstacaoPage from '~/pages/estacao/[id].vue'
import type { PanelMe } from '~/stores/session'
import { DELIVERY, KITCHEN, UNIT, item, stages } from '../support/operation-fixtures'

const { submit } = vi.hoisted(() => ({
  submit: vi.fn(() => Promise.resolve({ idempotencyKey: 'k', settled: new Promise(() => {}) })),
}))
mockNuxtImport('useOperations', () => () => ({
  submit,
  onSettled: vi.fn(),
  dismissFailure: vi.fn(),
}))

const limits = { attentionAfterMinutes: 7, lateAfterMinutes: 15 }
const sentAt = '2026-10-01T20:00:00.000Z'
const at = (minutes: number) => Date.parse(sentAt) + minutes * 60_000

function card(overrides: Partial<StationCard> = {}, lines = [item()]): StationCard {
  return {
    orderId: 'o1',
    tabId: 't1',
    tabNumber: 12,
    customerName: 'Dona Marta',
    tabMode: 'open_tab',
    numberInTab: 1,
    isAdditional: false,
    sentAt,
    attentionAt: '2026-10-01T20:07:00.000Z',
    lateAt: '2026-10-01T20:15:00.000Z',
    otherStationsQuantity: 0,
    lines: lines.map((line) => toLine(line, KITCHEN)),
    ackRequired: false,
    ...overrides,
  }
}

function mountCard(props: Partial<InstanceType<typeof StationOrderCard>['$props']> = {}) {
  return mountSuspended(StationOrderCard, {
    props: { card: card(), stages, limits, now: at(1), ...props },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  submit.mockClear()
})

describe('cartão do pedido na estação (spec 04, seção 8.2)', () => {
  it('mostra número, nome, quantidade, produto, modificadores, observação e o relógio mm:ss', async () => {
    const wrapper = await mountCard({
      card: card({}, [
        item({
          note: 'sem sal',
          modifiers: [
            {
              modifierId: 'm',
              groupName: 'Ponto da carne',
              modifierName: 'Ao ponto',
              priceDeltaCents: 0,
            },
          ],
        }),
      ]),
      now: at(1) + 5_000,
      isNew: true,
    })
    const text = wrapper.text()
    expect(text).toContain('12')
    expect(text).toContain('Dona Marta')
    expect(text).toContain('3×')
    expect(text).toContain('Espeto de carne')
    expect(text).toContain('Ao ponto')
    expect(text).toContain('Obs.: sem sal')
    expect(wrapper.get('[data-testid="card-clock"]').text()).toBe('01:05')
    expect(wrapper.get('[data-testid="card-status"]').text()).toBe('Novo')
  })

  it('CA-08.03, CA-08.06, CA-04.24: níveis de tempo sempre com texto e ícone', async () => {
    const attention = await mountCard({ now: at(8) })
    const header = attention.get('[data-testid="card-header"]')
    expect(header.classes()).toContain('bg-status-attention-bg')
    expect(attention.get('[data-testid="card-status"]').text()).toBe('Atenção')
    expect(attention.find('[data-testid="card-status"] svg').exists()).toBe(true)
    expect(attention.get('[data-testid="card-status"] path').attributes('d')).toBe('M6 3h12')

    const late = await mountCard({ now: at(16) })
    expect(late.get('[data-testid="card-status"]').text()).toBe('Atrasado · 16 min')
    expect(late.get('[data-testid="card-header"]').classes()).toContain('bg-status-late-bg')

    // Limite de atenção mudado para 10: o cartão de 8 min volta ao normal sem recarregar.
    const relaxed = await mountCard({
      now: at(8),
      limits: { attentionAfterMinutes: 10, lateAfterMinutes: 15 },
    })
    expect(relaxed.get('[data-testid="card-status"]').text()).toBe('No prazo')
  })

  it('cartão novo em atenção mostra a cor do tempo e mantém o "Novo" como chip', async () => {
    const wrapper = await mountCard({ now: at(8), isNew: true })
    expect(wrapper.get('[data-testid="card-status"]').text()).toBe('Atenção')
    expect(wrapper.find('[data-status="new"]').text()).toContain('Novo')
  })

  it('RN-04.41: tocar numa linha avança só ela', async () => {
    const wrapper = await mountCard({
      card: card({}, [item({ id: 'a' }), item({ id: 'b', productName: 'Kafta' })]),
    })
    await wrapper.findAll('[data-testid="line-advance"]')[1]!.trigger('click')
    const emitted = wrapper.emitted('advanceLine') as [{ id: string }, number][]
    expect(emitted.map(([line, quantity]) => [line.id, quantity])).toEqual([['b', 3]])
  })

  it('CA-04.20: linha feita fica riscada com ícone, sem ação, e o cartão continua', async () => {
    const wrapper = await mountCard({
      card: card({}, [
        item({ id: 'a', stageId: 's2', stageName: 'Preparando' }),
        item({ id: 'b', productName: 'Pão de alho', stationId: DELIVERY, stageName: 'Pronto' }),
      ]),
    })
    const lines = wrapper.findAll('[data-testid="card-line"]')
    expect(lines[1]!.attributes('data-state')).toBe('done')
    expect(lines[1]!.find('.line-through').exists()).toBe(true)
    expect(lines[1]!.find('[aria-label="Feito"]').exists()).toBe(true)
    expect(lines[1]!.get('[data-testid="line-advance"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="advance-card"]').text()).toContain('Pronto')
  })

  it('CA-04.17: o botão do cartão avança o pedido inteiro; rótulo "Começar" na primeira etapa', async () => {
    const wrapper = await mountCard()
    const button = wrapper.get('[data-testid="advance-card"]')
    expect(button.text()).toContain('Começar')
    expect(button.classes()).toContain('min-h-14')
    expect(button.classes()).not.toContain('bg-primary')
    await button.trigger('click')
    expect(wrapper.emitted('advanceCard')).toHaveLength(1)
  })

  it('CA-04.21 e CA-04.22: "+ N itens em outra estação" e "Adicional · pedido 2"', async () => {
    const wrapper = await mountCard({
      card: card({ otherStationsQuantity: 1, isAdditional: true, numberInTab: 2 }),
    })
    expect(wrapper.get('[data-testid="other-stations"]').text()).toBe('+ 1 item em outra estação')
    expect(wrapper.text()).toContain('Adicional · pedido 2')
  })

  it('CA-04.23: linha cancelada riscada com "Cancelado" e o motivo', async () => {
    const wrapper = await mountCard({
      card: card({}, [
        item({ id: 'a' }),
        item({
          id: 'b',
          productName: 'Kafta',
          canceledAt: '2026-10-01T20:02:00.000Z',
          cancelReason: 'cliente desistiu',
          stationId: null,
        }),
      ]),
    })
    const canceled = wrapper.findAll('[data-testid="card-line"]')[1]!
    expect(canceled.attributes('data-state')).toBe('canceled')
    expect(canceled.get('[data-testid="line-canceled"]').text()).toContain('Cancelado')
    expect(canceled.text()).toContain('Motivo: cliente desistiu')
  })

  it('RN-04.45: tudo cancelado mostra o destaque e "Ciente"', async () => {
    const wrapper = await mountCard({
      card: card({ ackRequired: true }, [
        item({ canceledAt: '2026-10-01T20:02:00.000Z', stationId: null }),
      ]),
    })
    expect(wrapper.get('[data-testid="card-status"]').text()).toBe('Cancelado')
    await wrapper.get('[data-testid="acknowledge"]').trigger('click')
    expect(wrapper.emitted('acknowledge')).toHaveLength(1)
  })

  it('RN-04.24: avançar parte pergunta quantas seguem', async () => {
    const wrapper = await mountCard()
    await wrapper.get('[data-testid="line-menu"]').trigger('click')
    await wrapper.get('[data-testid="advance-part"]').trigger('click')
    await wrapper.get('[data-testid="advance-2"]').trigger('click')
    const emitted = wrapper.emitted('advanceLine') as [{ id: string }, number][]
    expect(emitted[0]![1]).toBe(2)
  })

  it('CA-08.04: linha e menu da linha com alvo de toque de 48 px ou mais', async () => {
    const wrapper = await mountCard()
    expect(wrapper.get('[data-testid="line-advance"]').classes()).toContain('min-h-14')
    expect(wrapper.get('[data-testid="line-menu"]').classes()).toContain('w-12')
  })
})

describe('tela da estação (CA-04.18)', () => {
  const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'
  function me(): PanelMe {
    return {
      subject: { type: 'staff', id: ID, name: 'Bruno', email: null, username: 'bruno' },
      organization: {
        id: ID,
        name: 'Espetinho do Piloto',
        accessCode: 'ESPT26',
        subscriptionStatus: 'pilot',
        suspendedReason: null,
      },
      units: [
        {
          id: UNIT,
          name: 'Barraca da Praça',
          allStations: false,
          stationIds: [KITCHEN],
          stations: [{ id: KITCHEN, name: 'Cozinha', kind: 'queue' }],
          canOperateCash: false,
          lateAfterMinutes: 15,
        },
      ],
      session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
      impersonation: null,
    }
  }

  function queue(): StationQueue {
    const base = card()
    const { ackRequired: _a, ...older } = base
    return {
      stationId: KITCHEN,
      unitId: UNIT,
      ...limits,
      stages,
      orders: [
        { ...older, orderId: 'o2', sentAt: '2026-10-01T20:10:00.000Z', tabNumber: 13 },
        older,
      ],
    }
  }

  it('um cartão por pedido, mais antigo primeiro, uma coluna no celular e colunas fixas na tela grande', async () => {
    const session = useSessionStore()
    session.me = me()
    session.status = 'authenticated'
    vi.spyOn(useNuxtApp().$api, 'GET').mockImplementation(((route: string) =>
      Promise.resolve(
        route === '/api/v1/stations/{id}/queue'
          ? { data: queue(), error: undefined, response: new Response('{}') }
          : { data: undefined, error: undefined, response: new Response('{}') },
      )) as never)
    const wrapper = await mountSuspended(EstacaoPage, { route: `/estacao/${KITCHEN}` })
    await flushPromises()
    const cards = wrapper.findAll('[data-testid="order-card"]')
    expect(cards.map((c) => c.attributes('data-order-id'))).toEqual(['o1', 'o2'])
    const grid = wrapper.get('[data-testid="kds-grid"]')
    expect(grid.classes()).toContain('grid-cols-1')
    expect(grid.classes()).toContain('sm:grid-cols-[repeat(auto-fill,minmax(var(--kds-card),1fr))]')
    expect(grid.attributes('style')).toContain('--kds-card: 300px')
    // Colaborador só com a Cozinha: sem "Painel" nem "Trocar de estação" (CA-01.17).
    expect(wrapper.find('[data-testid="go-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="switch-station"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="counters"]').text()).toContain('Todos')
  })

  it('CA-04.17: o botão do cartão manda o pedido inteiro pela fila local', async () => {
    const session = useSessionStore()
    session.me = me()
    session.status = 'authenticated'
    vi.spyOn(useNuxtApp().$api, 'GET').mockImplementation(((route: string) =>
      Promise.resolve(
        route === '/api/v1/stations/{id}/queue'
          ? { data: queue(), error: undefined, response: new Response('{}') }
          : { data: undefined, error: undefined, response: new Response('{}') },
      )) as never)
    const wrapper = await mountSuspended(EstacaoPage, { route: `/estacao/${KITCHEN}` })
    await flushPromises()
    await wrapper.findAll('[data-testid="advance-card"]')[0]!.trigger('click')
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/v1/orders/o1/advance',
        body: { stationId: KITCHEN, items: [{ id: 'i1', version: 0 }] },
        meta: expect.objectContaining({ kind: 'order.advance', orderId: 'o1' }),
      }),
    )
  })
})
