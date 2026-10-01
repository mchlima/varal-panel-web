import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import Estacoes from '~/pages/estacoes.vue'
import type { PanelMe, PanelUnit } from '~/stores/session'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'
const COUNTER = '01a0f6f8-0000-7000-8000-0000000000e1'
const KITCHEN = '01a0f6f8-0000-7000-8000-0000000000e2'

function me(type: 'owner' | 'staff', units: PanelMe['units']): PanelMe {
  return {
    subject: { type, id: ID, name: 'Ana Souza', email: null, username: 'ana' },
    organization: {
      id: ID,
      name: 'Espetinho do Piloto',
      accessCode: 'ESPT26',
      subscriptionStatus: 'pilot',
    },
    units,
    session: { id: ID, deviceId: ID, accessTokenExpiresAt: '', expiresAt: '' },
  }
}

function unit(name: string, stations: PanelUnit['stations'] = []): PanelUnit {
  return {
    id: `${ID.slice(0, -4)}${name.length}000`.slice(0, 36),
    name,
    allStations: false,
    stationIds: stations.map((station) => station.id),
    stations,
    canOperateCash: false,
    lateAfterMinutes: 15,
  }
}

describe('/estacoes (spec 01, seção 14)', () => {
  it('com mais de uma unidade, escolhe a unidade antes', async () => {
    const session = useSessionStore()
    useWorkplaceStore().clear()
    session.me = me('staff', [unit('Barraca da Praça'), unit('Feira do Sábado')])
    session.status = 'authenticated'
    const wrapper = await mountSuspended(Estacoes)
    expect(wrapper.get('h1').text()).toBe('Escolha a unidade')
    expect(wrapper.text()).toContain('Barraca da Praça')
    expect(wrapper.text()).toContain('Feira do Sábado')
  })

  it('sem estações: estado vazio honesto e, para o dono, atalho para o painel', async () => {
    const session = useSessionStore()
    useWorkplaceStore().clear()
    session.me = me('owner', [{ ...unit('Barraca da Praça'), allStations: true }])
    session.status = 'authenticated'
    const wrapper = await mountSuspended(Estacoes)
    expect(wrapper.text()).toContain('Nenhuma estação configurada ainda.')
    expect(wrapper.find('a[href="/painel"]').text()).toBe('Ir para o painel')
  })

  it('RN-03.16: mostra as estações liberadas com o nome e o tipo reais, sem numerar', async () => {
    const session = useSessionStore()
    useWorkplaceStore().clear()
    session.me = me('staff', [
      unit('Barraca da Praça', [
        { id: COUNTER, name: 'Balcão', kind: 'counter' },
        { id: KITCHEN, name: 'Cozinha', kind: 'queue' },
      ]),
    ])
    session.status = 'authenticated'
    const wrapper = await mountSuspended(Estacoes)
    const buttons = wrapper.findAll('button[aria-pressed]')
    expect(buttons.map((b) => b.text())).toEqual([
      expect.stringContaining('Balcão'),
      expect.stringContaining('Cozinha'),
    ])
    expect(buttons[0]!.text()).toContain('Balcão de pedidos')
    expect(buttons[1]!.text()).toContain('Fila')
    expect(wrapper.text()).not.toContain('Estação 1')
    expect(buttons[0]!.classes()).toContain('min-h-20')
  })

  it('balcão leva ao /balcao e fila ao /estacao/{id}, guardando a escolha', async () => {
    const session = useSessionStore()
    useWorkplaceStore().clear()
    session.me = me('staff', [
      unit('Barraca da Praça', [
        { id: COUNTER, name: 'Balcão', kind: 'counter' },
        { id: KITCHEN, name: 'Cozinha', kind: 'queue' },
      ]),
    ])
    session.status = 'authenticated'
    const wrapper = await mountSuspended(Estacoes)
    const buttons = wrapper.findAll('button[aria-pressed]')

    navigateToMock.mockClear()
    await buttons[1]!.trigger('click')
    expect(navigateToMock).toHaveBeenCalledWith(`/estacao/${KITCHEN}`)
    expect(useWorkplaceStore().stationId).toBe(KITCHEN)

    await buttons[0]!.trigger('click')
    expect(navigateToMock).toHaveBeenLastCalledWith('/balcao')
    expect(useWorkplaceStore().stationId).toBe(COUNTER)
  })
})
