import { describe, expect, it } from 'vitest'
import {
  choicesLabel,
  explainError,
  isNewer,
  modifierLimitsError,
  parseInteger,
  stationInUseHint,
} from '../../app/lib/setup'
import { emailError, passwordError, permissionSummary, usernameError } from '../../app/lib/staff'

const apiError = (code: string, details: Record<string, unknown> = {}) => ({
  error: { code, message: `mensagem de ${code}`, details },
})

describe('modificadores (RN-03.13)', () => {
  it('0 ≤ mínimo ≤ máximo e máximo ≥ 1', () => {
    expect(modifierLimitsError(0, 1)).toBeNull()
    expect(modifierLimitsError(1, 1)).toBeNull()
    expect(modifierLimitsError(0, 5)).toBeNull()
    expect(modifierLimitsError(0, 0)).toBe('O máximo precisa ser pelo menos 1.')
    expect(modifierLimitsError(-1, 2)).toBe('O mínimo não pode ser negativo.')
    expect(modifierLimitsError(3, 2)).toBe('O mínimo não pode ser maior que o máximo.')
  })

  it('descreve a regra: mínimo ≥ 1 é obrigatório', () => {
    expect(choicesLabel(1, 1)).toBe('Obrigatório, escolha 1')
    expect(choicesLabel(0, 3)).toBe('Opcional, até 3')
    expect(choicesLabel(1, 3)).toBe('Obrigatório, de 1 a 3')
  })

  it('lê inteiros digitados', () => {
    expect(parseInteger(' 15 ')).toBe(15)
    expect(parseInteger('1.5')).toBeNull()
    expect(parseInteger('')).toBeNull()
  })
})

describe('erros da configuração explicados', () => {
  it('RN-03.02, RN-03.07: CASH_REGISTER_OPEN e LAST_ACTIVE_UNIT trazem a mensagem da API e o que fazer', () => {
    const open = explainError(apiError('CASH_REGISTER_OPEN'))
    expect(open.message).toBe('mensagem de CASH_REGISTER_OPEN')
    expect(open.hint).toContain('Feche o caixa')
    expect(explainError(apiError('ITEMS_IN_PROGRESS')).hint).toContain('itens sendo preparados')
    expect(explainError(apiError('LAST_ACTIVE_UNIT')).hint).toContain('outra unidade')
  })

  it('CA-03.10: nome reservado, repetido e tabela em uso explicam o que fazer', () => {
    expect(explainError(apiError('PRICE_LIST_NAME_RESERVED')).hint).toContain('"Normal"')
    expect(explainError(apiError('PRICE_LIST_NAME_TAKEN')).hint).toContain('outro nome')
    expect(explainError(apiError('PRICE_LIST_IN_USE')).hint).toContain('tabela vigente')
    expect(explainError(apiError('EVENT_ALREADY_IN_PROGRESS')).hint).toContain('Encerre')
  })

  it('STATION_IN_USE diz quem usa a estação', () => {
    expect(
      explainError(apiError('STATION_IN_USE', { stages: 1, categories: 2, products: 0 })).hint,
    ).toBe(
      'Em uso por: 1 etapa do fluxo, 2 categorias. Troque a estação deles antes de desativar ou mudar o tipo.',
    )
    expect(stationInUseHint({})).toContain('Troque a estação')
  })

  it('VERSION_CONFLICT sugere recarregar; erro de rede tem mensagem própria', () => {
    expect(explainError(apiError('VERSION_CONFLICT')).hint).toContain('Recarregue')
    expect(explainError(new TypeError('fetch failed')).message).toContain('Sem conexão')
  })

  it('eventos com versão menor ou igual à conhecida são ignorados (spec 01, seção 10)', () => {
    expect(isNewer(3, 2)).toBe(true)
    expect(isNewer(2, 2)).toBe(false)
    expect(isNewer(1, 2)).toBe(false)
    expect(isNewer(1, null)).toBe(true)
  })
})

describe('colaboradores (RN-03.15, RN-03.16)', () => {
  it('valida usuário, senha e e-mail opcional', () => {
    expect(usernameError('ana')).toBeNull()
    expect(usernameError('joao.silva_2')).toBeNull()
    expect(usernameError('an')).not.toBeNull()
    expect(usernameError('ana souza')).not.toBeNull()
    expect(passwordError('1234567')).not.toBeNull()
    expect(passwordError('12345678')).toBeNull()
    expect(emailError('')).toBeNull()
    expect(emailError('ana@')).toBe('Confira o e-mail.')
  })

  it('resume as permissões por unidade', () => {
    expect(
      permissionSummary({
        unitId: 'u',
        unitName: 'Barraca da Praça',
        stationIds: ['a', 'b'],
        stations: [
          { id: 'a', name: 'Balcão', kind: 'counter' },
          { id: 'b', name: 'Cozinha', kind: 'queue' },
        ],
        canOperateCash: true,
      }),
    ).toBe('Barraca da Praça: Balcão, Cozinha · opera caixa')
  })
})
