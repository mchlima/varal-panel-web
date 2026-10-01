import { describe, expect, it } from 'vitest'
import { apiErrorMessage, NETWORK_ERROR_MESSAGE } from '~/lib/api-error'
import { homePathFor, isLoginRoute, isPublicRoute } from '~/lib/routes'
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

  it('depois do login: dono no painel, colaborador nas estações', () => {
    expect(homePathFor('owner')).toBe('/painel')
    expect(homePathFor('staff')).toBe('/estacoes')
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
