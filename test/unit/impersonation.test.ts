import { describe, expect, it } from 'vitest'
import { formatRemaining, impersonationErrorMessage } from '../../app/lib/impersonation'

describe('"entrar como" (spec 02, seção 7)', () => {
  it('tempo restante em minutos, arredondado para cima (RN-02.19)', () => {
    expect(formatRemaining(60 * 60_000)).toBe('60 min')
    expect(formatRemaining(59 * 60_000 + 1)).toBe('60 min')
    expect(formatRemaining(61_000)).toBe('2 min')
    expect(formatRemaining(60_000)).toBe('1 min')
    expect(formatRemaining(30_000)).toBe('menos de 1 min')
    expect(formatRemaining(0)).toBe('encerrando…')
  })

  it('erros da troca do link explicam o que aconteceu (RN-02.21)', () => {
    expect(impersonationErrorMessage(401, 'UNAUTHENTICATED', 'x')).toContain(
      'só funciona no navegador em que você está logado no admin',
    )
    expect(impersonationErrorMessage(400, 'INVALID_IMPERSONATION_TOKEN', 'x')).toContain(
      'já foi usado ou venceu',
    )
    expect(impersonationErrorMessage(429, 'RATE_LIMITED', 'Muitas tentativas.')).toBe(
      'Muitas tentativas.',
    )
  })
})
