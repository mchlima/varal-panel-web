import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Estacoes from '~/pages/estacoes.vue'
import type { PanelMe } from '~/stores/session'

const ID = '01a0f6f8-4a82-77c9-b59d-f7b27d590e8e'

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

function unit(name: string, stationIds: string[] = []) {
  return {
    id: `${ID.slice(0, -4)}${name.length}000`.slice(0, 36),
    name,
    allStations: false,
    stationIds,
    canOperateCash: false,
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

  it('lista as estações liberadas do colaborador como botões grandes', async () => {
    const session = useSessionStore()
    useWorkplaceStore().clear()
    session.me = me('staff', [
      unit('Barraca da Praça', [
        '01a0f6f8-0000-7000-8000-0000000000e1',
        '01a0f6f8-0000-7000-8000-0000000000e2',
      ]),
    ])
    session.status = 'authenticated'
    const wrapper = await mountSuspended(Estacoes)
    const buttons = wrapper.findAll('button[aria-pressed]')
    expect(buttons.map((b) => b.text())).toEqual([
      expect.stringContaining('Estação 1'),
      expect.stringContaining('Estação 2'),
    ])
    expect(buttons[0]!.classes()).toContain('min-h-20')
    await buttons[1]!.trigger('click')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true')
    expect(useWorkplaceStore().stationId).toBe('01a0f6f8-0000-7000-8000-0000000000e2')
  })
})
