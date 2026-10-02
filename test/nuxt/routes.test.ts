import { describe, expect, it } from 'vitest'
import { apiErrorMessage, NETWORK_ERROR_MESSAGE } from '~/lib/api-error'
import {
  canOperateCashIn,
  hasPanelAccess,
  homePathFor,
  isLoginRoute,
  isPublicRoute,
} from '~/lib/routes'
import { isUuid, uuidv7 } from '~/lib/uuid'

describe('rotas do app (spec 01, seção 14.1)', () => {
  it('acesso aberto só nas telas de login e senha', () => {
    for (const path of ['/entrar', '/e/ESPT26', '/esqueci-a-senha', '/definir-senha']) {
      expect(isPublicRoute(path)).toBe(true)
    }
    for (const path of ['/estacoes', '/painel', '/balcao', '/']) {
      expect(isPublicRoute(path)).toBe(false)
    }
    expect(isLoginRoute('/e/ESPT26')).toBe(true)
    expect(isLoginRoute('/definir-senha')).toBe(false)
  })

  const unit = (
    stations: { id: string; kind: 'counter' | 'queue' }[],
    canOperateCash = false,
    id = 'u1',
  ) => ({ id, canOperateCash, stations })

  it('RN-01.23: painel para o dono e para quem opera caixa', () => {
    expect(hasPanelAccess({ subject: { type: 'owner' }, units: [] })).toBe(true)
    expect(
      hasPanelAccess({
        subject: { type: 'staff' },
        units: [unit([{ id: 'b', kind: 'counter' }], true)],
      }),
    ).toBe(true)
    expect(
      hasPanelAccess({ subject: { type: 'staff' }, units: [unit([{ id: 'k', kind: 'queue' }])] }),
    ).toBe(false)
  })

  it('depois do login (RN-01.26, CA-01.17): painel, estação única direto ou escolha', () => {
    expect(homePathFor({ subject: { type: 'owner' }, units: [] })).toBe('/painel')
    expect(
      homePathFor({
        subject: { type: 'staff' },
        units: [unit([{ id: 'b', kind: 'counter' }], true)],
      }),
    ).toBe('/painel')
    // Só a Cozinha: entra direto nela, sem painel nem "Trocar de estação".
    expect(
      homePathFor({ subject: { type: 'staff' }, units: [unit([{ id: 'k', kind: 'queue' }])] }),
    ).toBe('/estacao/k')
    expect(
      homePathFor({ subject: { type: 'staff' }, units: [unit([{ id: 'b', kind: 'counter' }])] }),
    ).toBe('/balcao')
    expect(
      homePathFor({
        subject: { type: 'staff' },
        units: [
          unit([
            { id: 'b', kind: 'counter' },
            { id: 'e', kind: 'queue' },
          ]),
        ],
      }),
    ).toBe('/estacoes')
    expect(homePathFor(null)).toBe('/entrar')
  })

  it('caixa: dono em todas as unidades; colaborador só onde opera caixa', () => {
    const staff = {
      subject: { type: 'staff' as const },
      units: [unit([], true, 'u1'), unit([], false, 'u2')],
    }
    expect(canOperateCashIn(staff, 'u1')).toBe(true)
    expect(canOperateCashIn(staff, 'u2')).toBe(false)
    expect(canOperateCashIn({ subject: { type: 'owner' }, units: [] }, 'u2')).toBe(true)
  })
})

describe('erros da API (spec 01, seção 5)', () => {
  it('mostra a message em pt-BR da API', () => {
    expect(
      apiErrorMessage({
        error: { code: 'X', message: 'Esta comanda já foi fechada.', details: {} },
      }),
    ).toBe('Esta comanda já foi fechada.')
  })

  it('erro de rede tem mensagem própria', () => {
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE)
  })
})

describe('uuidv7', () => {
  it('gera UUID v7 válido e ordenado no tempo', () => {
    const a = uuidv7(1_000)
    const b = uuidv7(2_000)
    expect(isUuid(a)).toBe(true)
    expect(a[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(a[19])
    expect(a < b).toBe(true)
  })
})
